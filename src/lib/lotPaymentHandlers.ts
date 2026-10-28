import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { alertCheckrFailure } from "@/lib/alertCheckrFailure";
import { createCheckrInvitation, computeAggregateStatus, CheckrResultEntry } from "@/lib/checkr";
import { recordMelyOSBillingCharge } from "@/lib/billingCharges";
import { generateApplicationFeeReceiptPdf } from "@/lib/generate-application-fee-receipt";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import { cancelAuthorization, captureAuthorization, lotOpenForApplication, notifyLotConflict, otherPaidHolder, releaseLotCheckoutHold } from "@/lib/lotCheckoutHold";

// Oct 28 (per Mely — two people paying for the same lot): the application-fee and Rent-to-Own deposit
// payment handlers (moved here from stripe-webhook so /api/cron/lot-payment-reconcile can run the
// exact same, idempotent code for a payment the webhook could not finish).

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function handleApplicationFeePaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const applicationId = session.metadata?.application_id;
  if (!applicationId) {
    console.log("Application fee webhook missing application_id metadata");
    return;
  }

  // Defaults to true so any older/other caller of this checkout route
  // (without this metadata) keeps the pre-existing always-run-Checkr behavior.
  const requiresBackgroundCheck =
    session.metadata?.requires_background_check !== "false";
  const stayAmount = Number(session.metadata?.stay_amount) || 0;
  const depositAmount = Number(session.metadata?.deposit_amount) || 0;
  const cardProcessingFee = Number(session.metadata?.card_processing_fee) || 0;
  // Aug 20 (per Mely — real-money design decision): true when MelyOS's
  // Checkr cost was already deducted from Aloha's share right in this
  // same checkout, via Stripe Connect — checkr-billing-report.ts (which
  // tracks money still owed by other means) needs to exclude these so
  // Aloha is never billed twice for the same background check.
  const checkrFeeChargedViaConnect = session.metadata?.checkr_fee_charged_via_connect === "true";
    const checkrFeeDeductedAmount = Number(session.metadata?.checkr_fee_deducted_amount) || 0;

  const amountPaid = (session.amount_total || 0) / 100;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  // Oct 20 (security review — webhook idempotency): if this application is
  // ALREADY marked paid, a second run would re-send the receipt, the admin
  // emails and — worst — a second set of Checkr invitations (real cost).
  // Skip it. Same payment intent = Stripe re-delivering the same event
  // (normal, nothing to do). A different/absent one means the fee was
  // already collected another way (e.g. Mark Fee Collected) and the
  // applicant ALSO paid online — flag it in System Health for a refund
  // review instead of silently ignoring real money.
  // Oct 28 (per Mely — two people paying for the same lot): sessions created since today only
  // AUTHORIZE the card (capture_method "manual"). Read the PaymentIntent's real state first:
  //  - "requires_capture": nothing charged yet → assign the lot, then capture (or cancel on conflict);
  //  - "succeeded": an older automatic-capture session → handled exactly as before;
  //  - "canceled": already canceled (by us for a lot conflict — notices are re-sent idempotently — or the
  //    authorization lapsed) → nothing to record.
  let pi: Stripe.PaymentIntent | null = null;
  if (paymentIntentId) {
    try { pi = await stripe.paymentIntents.retrieve(paymentIntentId); }
    catch { return "retry"; } // Stripe sends the event again
  }
  const manual = pi?.status === "requires_capture";
  // Oct 28 (review): this session was created authorize-only (every step after the capture is then
  // guarded so it can safely run again — see once() below).
  const sessionManual = session.metadata?.capture === "manual";
  const lotHoldId = session.metadata?.lot_id || "";
  const lotHoldRef = session.metadata?.lot_hold_ref || "";
  if (pi?.status === "canceled") {
    if (pi.metadata?.lot_cancel_reason === "lot_conflict") await notifyApplicationLotConflict(session, applicationId, "application fee");
    return;
  }
  // Each finishing step (notice, receipt, admin emails) runs once per payment: a marker per step in
  // stripe_processed_events. Older automatic-capture sessions keep their old one-shot behavior.
  const once = async (step: string): Promise<boolean> => {
    if (!sessionManual || !paymentIntentId) return true;
    const id = `appfee:${paymentIntentId}:${step}`;
    if ((await claimStripeEvent(id, "lot_checkout")) === "duplicate") return false;
    await finishStripeEvent(id, "lot_checkout", true);
    return true;
  };

  let resumeCapture = false;
  // Oct 28 (review): the capture went through at Stripe but this code never got to finish (our call
  // errored, or the function died) — finish every remaining step now instead of skipping.
  let finalizeOnly = false;
  {
    const { data: existing } = await supabase
      .from("resident_applications")
      .select("application_fee_paid, application_fee_stripe_payment_intent_id, checkr_invitation_sent_at, company_id, full_name, space_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (existing?.application_fee_paid) {
      const samePayment =
        !!paymentIntentId && existing.application_fee_stripe_payment_intent_id === paymentIntentId;
      if (samePayment && manual) {
        // An earlier delivery assigned the lot but the capture didn't go through (Stripe retried):
        // capture now and finish (receipt, Checkr, …) — those steps never ran on that delivery.
        resumeCapture = true;
      } else if (samePayment && sessionManual && pi?.status === "succeeded") {
        finalizeOnly = true;
      } else {
        console.warn(
          `stripe-webhook: application ${applicationId} already marked paid — skipping (${samePayment ? "duplicate delivery" : "different payment"}).`
        );
        if (!samePayment && existing.company_id) {
          // Oct 28: a second online payment for an application that is already paid. If it is only an
          // authorization, cancel it (nothing is charged) instead of asking for a refund.
          // Cancel only when ANOTHER online payment is recorded on the application (proof it owns the
          // fee). Marked paid by hand (no payment id) → leave the authorization alone and tell the office.
          const ownedByOtherPayment = !!existing.application_fee_stripe_payment_intent_id;
          if (manual && paymentIntentId && !ownedByOtherPayment) {
            await logIssueOnce(existing.company_id, "lot_payment_stuck", paymentIntentId,
              `${existing.full_name || "An applicant"} completed an online application-fee checkout ($${((session.amount_total || 0) / 100).toFixed(2)}), but the fee was already marked collected by hand. The card is only AUTHORIZED, not charged — it is released automatically in about 7 days. Do not capture it in Stripe; if the in-person payment didn't happen, contact MelyOS support. Stripe ${paymentIntentId}.`);
            return;
          }
          const canceled = manual && paymentIntentId ? (await cancelAuthorization(paymentIntentId, "duplicate")) === "canceled" : false;
          // Oct 28 (review): once per payment (the daily reconcile re-runs captured lot payments).
          await logIssueOnce(existing.company_id, canceled ? "duplicate_payment_canceled" : "refund_review", paymentIntentId || session.id,
            canceled
              ? `${existing.full_name || "An applicant"} completed a second online checkout for the application fee ($${((session.amount_total || 0) / 100).toFixed(2)}), but the application was already marked paid. The card was only authorized, so the authorization was canceled — nothing was charged (Stripe ${paymentIntentId}).`
              : `${existing.full_name || "An applicant"} paid the application fee online ($${((session.amount_total || 0) / 100).toFixed(2)}), but the application was already marked paid. Check for a double payment and refund if needed (Stripe ${paymentIntentId || session.id}).`);
        }
        return;
      }
    }

    // Oct 28 (per Mely): before anything is charged, make sure the lot is still this applicant's to
    // take — no other live application paid for it meanwhile, and it is still open (same rule as the
    // checkout). If not, cancel the authorization: no charge, no Stripe fee, nothing to refund.
    if (manual && !resumeCapture && existing?.space_id && existing.company_id) {
      const other = await otherPaidHolder(existing.company_id, existing.space_id, applicationId);
      if (other.error) return "retry";
      const { open } = await lotOpenForApplication(existing.space_id, existing.company_id);
      if (other.holder || !open) {
        const r = await cancelAuthorization(paymentIntentId!, "lot_conflict");
        if (r === "error") return "retry";
        if (r === "canceled") {
          await notifyApplicationLotConflict(session, applicationId, "application fee");
          if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef);
          return;
        }
        // r === "captured" can't happen for a requires_capture intent; fall through as paid.
      }
    }
  }

  const APP_COLS =
    "id, full_name, email, application_fee_total, application_fee_primary, application_fee_per_additional, application_fee_additional_count, application_processing_fee, background_check_required, company_id, occupants, space_id, park_share_total, checkr_invitation_sent_at, checkr_results";
  const { data: application, error } = finalizeOnly
    // Already marked paid by this same payment: read it, never re-write it (that would reset
    // background_check_status after Checkr was sent).
    ? await supabase.from("resident_applications").select(APP_COLS).eq("id", applicationId).single()
    : await supabase
    .from("resident_applications")
    .update({
      application_fee_paid: true,
      application_fee_paid_at: new Date().toISOString(),
      application_fee_stripe_payment_intent_id: paymentIntentId,
      background_check_status: requiresBackgroundCheck
        ? "payment_confirmed"
        : "not_required",
      // Aug 17 (per Mely — "si el background no se paga, este cargo se
      // cobra junto con el primer mes, renta y depósito"): persisted so
      // Approve Application (melyos-builder) can see what was already
      // collected here and avoid double-charging the same first month's
      // rent/deposit again through the normal billing-profile/first-
      // invoice flow. NOT YET WIRED UP on the approval side — see Mely's
      // note in system-connections-audit.md before relying on this.
      rent_prepaid_amount: stayAmount || null,
      deposit_prepaid_amount: depositAmount || null,
      checkr_fee_charged_via_connect: checkrFeeChargedViaConnect,
      checkr_fee_deducted_amount: checkrFeeDeductedAmount,
    })
    .eq("id", applicationId)
    .select(APP_COLS)
    .single();

  // Oct 28 (per Mely): the lot is now this applicant's (marked paid above, guarded by
  // unique_active_application_lot_hold) — NOW take the money. The Connect split (park transfer +
  // MelyOS application fee, incl. the Checkr deduction) happens at this capture.
  let capturedPi: Stripe.PaymentIntent | null = finalizeOnly ? pi : null;
  if (!error && manual && paymentIntentId) {
    const cap = await captureAuthorization(paymentIntentId);
    if (cap.result === "retry") return "retry"; // stays marked paid; the retry captures and finishes
    if (cap.result === "gone") {
      // The authorization can't be captured any more (expired/canceled): undo the "paid" mark.
      await supabase
        .from("resident_applications")
        .update({ application_fee_paid: false, application_fee_paid_at: null, application_fee_stripe_payment_intent_id: null })
        .eq("id", applicationId)
        .eq("application_fee_stripe_payment_intent_id", paymentIntentId);
      if (application?.company_id) {
        await logSystemHealthIssue({
          companyId: application.company_id,
          issueType: "payment_failed",
          source: "stripe_webhook",
          message: `${application.full_name || "An applicant"}'s card authorization for the application fee ($${amountPaid.toFixed(2)}) could not be captured (status: ${cap.pi?.status || "unknown"}), so nothing was charged and the application is NOT marked paid. Ask them to pay again. Stripe ${paymentIntentId}, session ${session.id}.`,
        });
      }
      return;
    }
    capturedPi = cap.pi;
  }
  // Captured (now or on an earlier try): into the Daily Close ledger — the generic step in the
  // webhook only runs for "paid" sessions. Upsert on the session id, so never twice.
  if (!error && sessionManual && paymentIntentId && (capturedPi || pi?.status === "succeeded")) {
    await logRvOnlinePayment({
      companyId: application?.company_id || null,
      sourceId: session.id,
      description: "Application fee (online)",
      payerName: session.customer_details?.name || session.customer_details?.email || session.customer_email || null,
      amountCents: Number(capturedPi?.amount_received || pi?.amount_received || session.amount_total || 0),
      reference: paymentIntentId,
    });
  }

  // Aug 11 (per Mely): the DB's unique_active_application_lot_hold index
  // already blocks a SECOND active paid application from holding the
  // same lot — but only discovers the conflict here, AFTER this
  // person's card was already charged (see the 23505 handler below,
  // which then has to clear their space_id and alert admin to sort out
  // a refund). This is the actual fix: the moment payment is confirmed,
  // pull the lot from 'available' immediately so a second applicant
  // never sees it as selectable in the first place — the constraint
  // above becomes a last-resort safety net for a genuine same-instant
  // race, not the primary defense.
  // Oct 28 (review): once per payment — the daily reconcile re-runs this handler and must not
  // re-reserve a lot the office or the abandoned-hold cron released since.
  if (!error && application?.space_id && (await once("reserve_lot"))) {
    await supabase
      .from("rv_lots")
      .update({ status: "reserved" })
      .eq("id", application.space_id)
      .eq("status", "available");
  }

  // Aug 21 (per Mely): records an itemized, permanent row the company
  // can see for themselves under Settings > Billing > Charges — amount
  // is MelyOS's own cut (what was deducted), markup is what the company
  // actually netted from this same background check.
  // Oct 28 (review): once per application (a finishing retry must not bill the check twice).
  const checkrChargeThere = !error && sessionManual && application?.id
    ? ((await supabase.from("melyos_billing_charges").select("id").eq("resident_application_id", application.id).eq("charge_type", "Background Check").limit(1)).data || []).length > 0
    : false;
  if (!error && !checkrChargeThere && checkrFeeChargedViaConnect && checkrFeeDeductedAmount > 0 && application?.company_id) {
    // Aug 21 (per Mely — "si se hacen '3' background check por ejemplo
    // eso se vera ahi?"): amount/markup here are the TOTAL across all
    // people on this application (1 primary + N additional), combined
    // into one row — the description needs to say how many, or it
    // reads as if only one check happened when it might be several.
    const totalCheckCount = 1 + (Number(application.application_fee_additional_count) || 0);
    await recordMelyOSBillingCharge({
      companyId: application.company_id,
      chargeType: "Background Check",
      source: "MelyOS",
      description: `Background Check (${totalCheckCount}) — ${application.full_name}`,
      amount: checkrFeeDeductedAmount,
      markup: Math.max(0, Number(application.park_share_total || 0) - checkrFeeDeductedAmount),
      residentApplicationId: application.id,
    });
  }

  // Aug 20 (per Mely — "no se vio la notificacion que el residente
  // pago"): every OTHER successful checkout in this codebase (propane,
  // etc.) notifies the admin via resident_update_notifications — this
  // one only ever did it for the lot-conflict edge case below, never
  // for a normal successful payment with no conflict at all.
  if (!error && application?.company_id && (await once("notify"))) {
    const backgroundCheckLabel = requiresBackgroundCheck
      ? " (includes background check)"
      : "";
    await supabase.from("resident_update_notifications").insert({
      company_id: application.company_id,
      resident_name: application.full_name,
      update_type: "application_fee_paid",
           message: `${application.full_name} paid their application fee${backgroundCheckLabel}: $${amountPaid.toFixed(2)}.`,
    });
  }

  if (error) {
    // Aug 6 (per Mely: every function must work correctly with several
    // applicants at once) — unique_active_application_lot_hold can reject
    // this exact update if someone else's application already grabbed
    // this lot a moment earlier. The applicant's card was ALREADY charged
    // by Stripe before this webhook runs, so we can't just drop this
    // silently: record the payment anyway (clearing space_id so it
    // doesn't collide with the constraint), and alert admin urgently
    // since a real person paid for a lot they can no longer have.
    if (error.code === "23505" && error.message?.includes("unique_active_application_lot_hold")) {
      // Oct 28 (per Mely): authorize-only payment → another applicant got the lot at the same instant;
      // cancel the authorization (nothing charged) instead of keeping money for a lot they can't have.
      if (manual && paymentIntentId) {
        const r = await cancelAuthorization(paymentIntentId, "lot_conflict");
        if (r === "error") return "retry";
        if (r === "canceled") {
          await notifyApplicationLotConflict(session, applicationId, "application fee");
          if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef);
          return;
        }
      }
      const { data: retryApplication } = await supabase
        .from("resident_applications")
        .update({
          application_fee_paid: true,
          application_fee_paid_at: new Date().toISOString(),
          application_fee_stripe_payment_intent_id: paymentIntentId,
          background_check_status: requiresBackgroundCheck ? "payment_confirmed" : "not_required",
          space_id: null,
          checkr_fee_charged_via_connect: checkrFeeChargedViaConnect,
          checkr_fee_deducted_amount: checkrFeeDeductedAmount,
        })
        .eq("id", applicationId)
        .select("id, full_name, email, company_id, application_fee_total, park_share_total, application_fee_additional_count")
        .single();

      if (checkrFeeChargedViaConnect && checkrFeeDeductedAmount > 0 && retryApplication?.company_id) {
        const totalCheckCount = 1 + (Number(retryApplication.application_fee_additional_count) || 0);
        await recordMelyOSBillingCharge({
          companyId: retryApplication.company_id,
          chargeType: "Background Check",
          source: "MelyOS",
          description: `Background Check (${totalCheckCount}) — ${retryApplication.full_name}`,
          amount: checkrFeeDeductedAmount,
          markup: Math.max(0, Number(retryApplication.park_share_total || 0) - checkrFeeDeductedAmount),
          residentApplicationId: applicationId,
        });
      }

      if (retryApplication?.company_id) {
        await supabase.from("resident_update_notifications").insert({
          company_id: retryApplication.company_id,
          resident_name: retryApplication.full_name,
          update_type: "application_lot_conflict",
                  message: `${retryApplication.full_name} paid their application fee ($${amountPaid.toFixed(2)}), but their selected lot was just taken by another applicant. Please contact them to choose a different lot (payment already collected).`,
        });
      }

      console.log(`Application ${applicationId}: lot conflict on fee payment, admin notified.`);
      return;
    }

    console.log("Error updating resident_applications after fee payment:", error.message);
    return manual ? "retry" : undefined; // authorize-only: nothing charged yet — let Stripe retry
  }

  if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef); // the paid application holds the lot now

  // Aug 6 (per Mely): once the application fee (incl. background check)
  // is paid, hold the selected lot as "reserved" (yellow on the map) so
  // it doesn't look free to book/apply for while this application is
  // still pending admin's decision. Flips to occupied on approval, or
  // back to available on denial — same "reserved" convention already
  // used for confirmed reservations and pending move-outs.
  if (application?.space_id && (await once("reserve_lot"))) {
    await supabase
      .from("rv_lots")
      .update({ status: "reserved" })
      .eq("id", application.space_id)
      .eq("status", "available");
  }

  console.log(
      `Application fee paid for ${application?.full_name} ($${amountPaid.toFixed(2)}).` +
      (requiresBackgroundCheck
        ? " Background check status: payment_confirmed."
        : ` No background check required for this stay (short stay${stayAmount > 0 ? `, $${stayAmount.toFixed(2)} stay charge included` : ""}).`)
  );

  // Each park sets their own notification email under Business Profile
  // (companies.contact_email) — this used to be a single hardcoded env var
  // shared across every company, which doesn't work once there's more than
  // one client on the platform. Falls back to the env var only if the park
  // hasn't set one yet.
  let adminNotifyEmail = process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com";
  if (application?.company_id) {
    const { data: notifyCompany } = await supabase
      .from("companies")
      .select("contact_email")
      .eq("id", application.company_id)
      .maybeSingle();
    if (notifyCompany?.contact_email) {
      adminNotifyEmail = notifyCompany.contact_email;
    }
  }

  // Aug 5 (per Mely — real bug she caught: some notification emails said
  // "MelyOS" as the sender instead of the actual park's name): fetch the
  // company name ONCE at function scope so every email sent from here —
  // not just the applicant's receipt — uses the real company name.
  let company: { company_name: string | null; address: string | null; logo_url: string | null } | null = null;
  if (application?.company_id) {
    const { data: companyRow } = await supabase
      .from("companies")
      .select("company_name, address, logo_url")
      .eq("id", application.company_id)
      .maybeSingle();
    company = companyRow;
  }

  // Send the applicant an actual PDF receipt (company name, amount,
  // description, receipt/transaction numbers) — the confirmation page
  // promises "a receipt has been sent to your email", so this needs to be
  // a real receipt, not just the Checkr invitation email's paragraph of
  // instructions.
  if (application?.email && process.env.RESEND_API_KEY && (await once("receipt"))) {
    try {
          const paymentDate = new Date(session.created * 1000);

      // Build the itemized breakdown from what was actually stored on the
      // application at submission time — not re-derived from the total,
      // so it always matches what the applicant agreed to.
      const lineItems: { description: string; qty: number; unitPrice: number; amount: number }[] = [];

      if (application.background_check_required) {
        const primaryFee = Number(application.application_fee_primary) || 0;
        if (primaryFee > 0) {
          lineItems.push({
            description: "Background Check (Primary Applicant)",
            qty: 1,
            unitPrice: primaryFee,
            amount: primaryFee,
          });
        }
        const additionalCount = Number(application.application_fee_additional_count) || 0;
        const additionalFee = Number(application.application_fee_per_additional) || 0;
        if (additionalCount > 0 && additionalFee > 0) {
          lineItems.push({
            description: "Additional Background Checks",
            qty: additionalCount,
            unitPrice: additionalFee,
            amount: additionalFee * additionalCount,
          });
        }
      }

      const processingFee = Number(application.application_processing_fee) || 0;
      if (processingFee > 0) {
        lineItems.push({
          description: "Application Fee",
          qty: 1,
          unitPrice: processingFee,
          amount: processingFee,
        });
      }

      if (stayAmount > 0) {
        lineItems.push({
          description: "RV Lot Stay Charge",
          qty: 1,
          unitPrice: stayAmount,
          amount: stayAmount,
        });
      }

      // Aug 17 (per Mely — "el pdf que me llego de pago no dice todo lo
      // que se cobro"): depositAmount was already parsed above but never
      // actually pushed onto the receipt — the deposit and card fee were
      // silently missing from the itemized breakdown even though the
      // Amount Paid total (computed from the real Stripe charge) was
      // always correct. Same gap for the card processing surcharge,
      // which this receipt-builder didn't even know existed until now.
      if (depositAmount > 0) {
        lineItems.push({
          description: "Security Deposit",
          qty: 1,
          unitPrice: depositAmount,
          amount: depositAmount,
        });
      }

      if (cardProcessingFee > 0) {
        lineItems.push({
          description: "Card Processing Fee",
          qty: 1,
          unitPrice: cardProcessingFee,
          amount: cardProcessingFee,
        });
      }

      // Fallback in case none of the stored breakdown fields are populated
      // (e.g. an application submitted before this itemization existed) —
      // still show something rather than an empty table.
      if (lineItems.length === 0) {
        lineItems.push({
          description: "Lease Application Fee",
          qty: 1,
          unitPrice: amountPaid,
          amount: amountPaid,
        });
      }

      // Simple, human-readable receipt number instead of a raw Stripe ID —
      // date + time is unique enough for a receipt label (not a DB key).
      const receiptNumber = `APP-${paymentDate
        .toLocaleDateString("en-US", { timeZone: "America/New_York" })
        .replace(/\//g, "")}-${paymentDate
        .toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })
        .replace(/:/g, "")
        .slice(0, 4)}`;

      const receiptPdf = await generateApplicationFeeReceiptPdf({
        companyName: company?.company_name || "Aloha RV Park",
        companyAddress: company?.address || null,
        companyLogoUrl: company?.logo_url || null,
        applicantName: application.full_name || "Applicant",
        lineItems,
        totalPaid: amountPaid,
        receiptNumber,
        transactionId: session.id,
        paymentDate,
      });

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${company?.company_name || "Aloha RV Park"} <noreply@aloharvparkfl.com>`,
          to: application.email,
          subject: `Receipt — Application Fee Paid ($${amountPaid.toFixed(2)})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>✅ Payment Confirmed</h2>
              <p>Thank you, ${application.full_name || "Applicant"}. Your application fee payment of
              $${amountPaid.toFixed(2)} was received. Your receipt is attached as a PDF.</p>
            </div>
          `,
          attachments: [
            {
              filename: "application-fee-receipt.pdf",
              content: receiptPdf.toString("base64"),
            },
          ],
        }),
      });
    } catch (receiptErr) {
      console.error("Failed to send application fee receipt PDF:", receiptErr);
    }
  }

  if (!requiresBackgroundCheck) {
    try {
      if (process.env.RESEND_API_KEY && (await once("admin_shortstay"))) {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${company?.company_name || "Aloha RV Park"} <noreply@aloharvparkfl.com>`,
            to: adminNotifyEmail,
            subject: `Short-stay application fee${stayAmount > 0 ? " + stay charge" : ""} paid for ${application?.full_name || "applicant"} — no background check needed`,
            html: `<p>${application?.full_name || "An applicant"} just paid their application fee${
              stayAmount > 0 ? ` and $${stayAmount.toFixed(2)} stay charge` : ""
            } for a short stay. No background check was required.</p>`,
          }),
        });
        const emailJson = await emailRes.json();
        if (!emailRes.ok) {
          console.error("Resend admin email failed:", emailJson);
        }
      }
    } catch (emailErr) {
      console.error("Failed to send short-stay admin notification:", emailErr);
    }
    return;
  }

  // Oct 28 (review): Checkr invitations are a real cost — never sent twice for one application
  // (a finishing retry after a lost capture answer, or the reconcile cron, stops here).
  if (application?.checkr_invitation_sent_at || (Array.isArray(application?.checkr_results) && application.checkr_results.length > 0)) {
    return;
  }

  const people: { personKey: string; name: string; email: string }[] = [];

  if (application?.email) {
    people.push({
      personKey: "primary",
      name: application.full_name || "Applicant",
      email: application.email,
    });
  }

  const occupants = (application?.occupants || []) as Array<{
    name?: string;
    date_of_birth?: string;
    email?: string;
  }>;
  occupants.forEach((occ, i) => {
    if (!occ?.name || !occ?.date_of_birth) return;
    const age = calculateAge(occ.date_of_birth);
    if (age === null || age < 18) return;
    people.push({
      personKey: `occupant:${i}`,
      name: occ.name,
      email: occ.email || application!.email,
    });
  });

  const results: CheckrResultEntry[] = [];

  // Aug 10 (per Mely): same integration/settings as the main admin-
  // triggered flow — reads the company's configured Work Location State
  // + Default Package from Lease Defaults instead of a hardcoded package.
  let checkrWorkLocationState = "";
  let checkrPackageSlug = "basic_plus_criminal";
  if (application.company_id) {
    const { data: settings } = await supabase
      .from("park_settings")
      .select("checkr_work_location_state, checkr_default_package_slug")
      .eq("company_id", application.company_id)
      .maybeSingle();
    checkrWorkLocationState = settings?.checkr_work_location_state || "";
    checkrPackageSlug = settings?.checkr_default_package_slug || "basic_plus_criminal";
  }

  if (!checkrWorkLocationState) {
    console.log(
      "Application background check: company hasn't set Checkr Work Location State in Lease Defaults — skipping all Checkr invitations for this application."
    );
    // Aug 11: FOUND REAL BUG — this used to just `return` here with no
    // admin notification at all, unlike every other failure path in this
    // function (which at least emails admin). That meant a paid
    // application fee with a missing Work Location State setting failed
    // COMPLETELY silently — applicant never got a background check
    // invite, admin never knew why. Now sends the same kind of alert as
    // the invitation-failed case below, with the specific reason.
    try {
      if (process.env.RESEND_API_KEY && (await once("admin_nostate"))) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${company?.company_name || "Aloha RV Park"} <noreply@aloharvparkfl.com>`,
            to: adminNotifyEmail,
            subject: `Application fee paid — background check NOT sent (Checkr Work Location State missing) for ${application?.full_name || "applicant"}`,
                      html: `<p>${application?.full_name || "An applicant"} just paid their $${amountPaid.toFixed(2)} application fee, but NO background check invitation was sent because "Checkr Work Location State" isn't set in Lease Defaults for this company.</p>
                   <p>Set it in Lease Defaults → Background Check, then invite this applicant's background check manually from the Applications tab.</p>`,
          }),
        });
      }
    } catch (emailErr) {
      console.error("Failed to send missing-work-location-state admin alert:", emailErr);
    }
    return;
  }

   const appFailures: { name: string; reason: string }[] = [];
  let primaryCandidateId: string | undefined;
  let primaryInvitationId: string | undefined;
  let primaryInvitationUrl: string | undefined;

  for (const person of people) {
    try {
      const { candidateId, invitationId, invitationUrl } = await createCheckrInvitation({
        applicationId: application.id,
        personKey: person.personKey,
        email: person.email,
        fullName: person.name,
        state: checkrWorkLocationState,
        packageSlug: checkrPackageSlug,
      });
      results.push({
        personKey: person.personKey,
        name: person.name,
        candidateId,
        status: "invitation_sent",
      });
      if (person.personKey === "primary") {
        primaryCandidateId = candidateId;
        primaryInvitationId = invitationId;
        primaryInvitationUrl = invitationUrl;
      }
    } catch (checkrErr: any) {
      console.error(`Checkr invitation failed for person ${person.personKey}:`, checkrErr.message);
      results.push({ personKey: person.personKey, name: person.name, status: "invitation_failed" });
      appFailures.push({ name: person.name, reason: String(checkrErr?.message || "Unknown Checkr error").slice(0, 300) });
    }
  }

  if (appFailures.length > 0) {
    // Park admin is already emailed below; this adds the real reason + a MelyOS copy.
    await alertCheckrFailure({
      applicationId: application.id,
      applicantName: application.full_name || "Applicant",
      companyId: application.company_id,
      failures: appFailures,
      notifyPark: false,
    });
  }

  const aggregateStatus = computeAggregateStatus(results);
  const anyInvitationSent = results.some((r) => r.status !== "invitation_failed");
  await supabase
    .from("resident_applications")
    .update({
      checkr_results: results,
      background_check_status: aggregateStatus,
      ...(anyInvitationSent
        ? {
            checkr_package_slug: checkrPackageSlug,
            checkr_invitation_sent_at: new Date().toISOString(),
            checkr_environment: process.env.CHECKR_ENVIRONMENT || "staging",
          }
        : {}),
      ...(primaryCandidateId ? { checkr_candidate_id: primaryCandidateId } : {}),
      ...(primaryInvitationId ? { checkr_invitation_id: primaryInvitationId } : {}),
      ...(primaryInvitationUrl ? { checkr_invitation_url: primaryInvitationUrl } : {}),
    })
    .eq("id", application.id);

  const checkrInvited = results.length > 0 && results.every((r) => r.status !== "invitation_failed");

  try {
    if (process.env.RESEND_API_KEY && (await once("admin_bg"))) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${company?.company_name || "Aloha RV Park"} <noreply@aloharvparkfl.com>`,
          to: adminNotifyEmail,
         subject: checkrInvited
            ? `Background check application sent for ${application?.full_name || "applicant"} (${results.length} ${results.length === 1 ? "person" : "people"})`
            : `Application fee paid — background check FAILED to send for ${application?.full_name || "applicant"}, check manually`,
          html: checkrInvited
            ? `<p>${application?.full_name || "An applicant"} just paid their $${amountPaid.toFixed(2)} application fee.</p>
               <p>The background check application has been sent for ${results.length} ${results.length === 1 ? "person" : "people"} on this application. You'll be notified again once results are in.</p>`
            : `<p>${application?.full_name || "An applicant"} just paid their $${amountPaid.toFixed(2)} application fee, but the background check failed to send.</p>
               <p>Check the Applications tab for details on who still needs to be invited manually.</p>`,
        }),
      });
      const emailJson = await emailRes.json();
      if (!emailRes.ok) {
        console.error("Resend admin email failed:", emailJson);
      } else {
        console.log("Admin notification email sent:", emailJson.id);
      }
    } else {
      console.log("RESEND_API_KEY not set — skipping admin notification email.");
    }
  } catch (emailErr) {
    console.error("Failed to send background check admin notification:", emailErr);
  }
}

function calculateAge(dateOfBirth: string): number | null {
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// Oct 28 (per Mely): notices when an applicant's authorize-only lot payment was canceled because the
// lot went to someone else (System Health + office notice once; a polite email to the payer once).
async function notifyApplicationLotConflict(session: Stripe.Checkout.Session, applicationId: string, kind: "application fee" | "Rent-to-Own deposit") {
  const { data: app } = await supabase
    .from("resident_applications")
    .select("full_name, email, company_id, space_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!app?.company_id) return;
  let lotName: string | null = null;
  const lotId = session.metadata?.lot_id || app.space_id;
  if (lotId) {
    const { data: lot } = await supabase.from("rv_lots").select("lot_name").eq("id", lotId).eq("company_id", app.company_id).maybeSingle();
    lotName = lot?.lot_name || null;
  }
  await notifyLotConflict({
    session,
    companyId: app.company_id,
    payerName: app.full_name || session.customer_details?.name || null,
    payerEmail: app.email || session.customer_details?.email || session.customer_email || null,
    lotName,
    kind,
    authorizationCanceled: true,
  });
}

// "This RTO deposit payment already took the lot" marker (stripe_processed_events, source lot_checkout).
// null = could not check (then nothing is canceled — the caller retries / the office is told).
async function lotMarkerExists(id: string): Promise<boolean | null> {
  const { data, error } = await supabase.from("stripe_processed_events").select("status").eq("event_id", id).eq("source", "lot_checkout").maybeSingle();
  if (error) return null;
  return !!data;
}
// Oct 28 (review): the marker must really be saved before the deposit is marked paid. true = saved (or
// already there — it's ours, same id); false = could not save → the caller retries and changes nothing.
async function setLotMarker(id: string): Promise<boolean> {
  const { error } = await supabase.from("stripe_processed_events").insert({ event_id: id, source: "lot_checkout", status: "done", finished_at: new Date().toISOString() });
  if (!error) return true;
  if (error.code === "23505") return (await lotMarkerExists(id)) === true;
  console.error("setLotMarker:", id, error.message);
  return false;
}
// Does ANOTHER payment's marker say it took this application's deposit? null = could not check.
async function otherPaymentOwnsDeposit(applicationId: string, myMarker: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("stripe_processed_events")
    .select("event_id")
    .eq("source", "lot_checkout")
    .like("event_id", `rto_assigned:${applicationId}:%`)
    .neq("event_id", myMarker)
    .limit(1);
  if (error) return null;
  return (data || []).length > 0;
}
// One System Health issue per payment for this kind (the daily reconcile may see it again).
async function logIssueOnce(companyId: string, issueType: string, ref: string, message: string) {
  const { data } = await supabase.from("system_health_issues").select("id").eq("company_id", companyId).eq("issue_type", issueType).like("message", `%${ref}%`).limit(1);
  if (data && data.length > 0) return;
  await logSystemHealthIssue({ companyId, issueType, source: "stripe_webhook", message });
}

// Oct 28 (per Mely / review): Rent-to-Own deposit. Authorize-only sessions: check the lot → record
// "this payment is taking the lot" (marker) → mark the deposit paid (guarded by the partial unique
// index unique_active_rto_deposit_lot_hold, when it exists) → capture. If the lot went to someone else
// the authorization is canceled (nothing charged). The hold is released only AFTER the deposit is
// marked paid. Every step can run again safely (Stripe retries, /api/cron/lot-payment-reconcile).
// Older automatic-capture sessions: marked paid as before (a repeat delivery is now ignored).
export async function handleRentToOwnDepositPaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const applicationId = session.metadata?.application_id;
  if (!applicationId) {
    console.log("Rent-to-own deposit webhook missing application_id metadata");
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  let pi: Stripe.PaymentIntent | null = null;
  if (paymentIntentId) {
    try { pi = await stripe.paymentIntents.retrieve(paymentIntentId); }
    catch { return "retry"; }
  }
  if (pi?.status === "canceled") {
    if (pi.metadata?.lot_cancel_reason === "lot_conflict") await notifyApplicationLotConflict(session, applicationId, "Rent-to-Own deposit");
    return;
  }
  const manual = pi?.status === "requires_capture";
  const sessionManual = session.metadata?.capture === "manual";
  const lotHoldId = session.metadata?.lot_id || "";
  const lotHoldRef = session.metadata?.lot_hold_ref || "";
  const amount = (session.amount_total || 0) / 100;
  // Names the application AND the payment, so "another payment took this deposit" can be proven.
  const assignedMarker = paymentIntentId ? `rto_assigned:${applicationId}:${paymentIntentId}` : "";

  const { data: current, error: readErr } = await supabase
    .from("resident_applications")
    .select("full_name, company_id, space_id, status, rent_to_own_deposit_paid")
    .eq("id", applicationId)
    .maybeSingle();
  if (readErr || !current) return sessionManual ? "retry" : undefined;

  if (current.rent_to_own_deposit_paid) {
    const mark = sessionManual && assignedMarker ? await lotMarkerExists(assignedMarker) : false;
    if (mark === null) return "retry"; // can't tell ours from a second payment — never cancel blindly
    const ours = mark === true;
    if (!ours) {
      if (!manual) {
        // A repeat delivery of an older automatic payment — nothing to do. A newer (authorize-only)
        // payment that is captured but isn't the one that took the deposit = paid twice: tell the office.
        if (sessionManual && pi?.status === "succeeded" && paymentIntentId && current.company_id) {
          await logIssueOnce(current.company_id, "refund_review", paymentIntentId,
            `${current.full_name || "An applicant"}'s Rent-to-Own deposit was already marked paid, and another online payment of $${amount.toFixed(2)} was also collected. Check for a double payment and refund one if needed (Stripe ${paymentIntentId}).`);
        }
        return;
      }
      // Only cancel as a duplicate when another payment's marker PROVES it took this deposit.
      const other = paymentIntentId ? await otherPaymentOwnsDeposit(applicationId, assignedMarker) : null;
      if (other === null) return "retry";
      if (other === true && paymentIntentId && current.company_id) {
        const r = await cancelAuthorization(paymentIntentId, "duplicate");
        if (r === "error") return "retry";
        await logIssueOnce(current.company_id, r === "canceled" ? "duplicate_payment_canceled" : "refund_review", paymentIntentId, r === "canceled"
          ? `${current.full_name || "An applicant"} completed a second checkout for their Rent-to-Own deposit ($${amount.toFixed(2)}), but another online payment had already paid it. The authorization was canceled — nothing was charged (Stripe ${paymentIntentId}).`
          : `${current.full_name || "An applicant"} paid their Rent-to-Own deposit a second time ($${amount.toFixed(2)}). Check for a double payment and refund if needed (Stripe ${paymentIntentId}).`);
        return;
      }
      // Marked paid some other way (in person / by hand): don't guess — leave the authorization alone.
      if (current.company_id && paymentIntentId) {
        await logIssueOnce(current.company_id, "lot_payment_stuck", paymentIntentId,
          `${current.full_name || "An applicant"} completed an online Rent-to-Own deposit checkout ($${amount.toFixed(2)}), but the deposit was already marked paid another way (in person or by hand). The card is only AUTHORIZED, not charged — it is released automatically in about 7 days. Do not capture it in Stripe; if the in-person payment didn't happen, contact MelyOS support. Stripe ${paymentIntentId}.`);
      }
      return;
    }
    // ours: an earlier try marked it paid — fall through to capture (if still needed) and finish.
  } else {
    if (manual && paymentIntentId) {
      // The lot is the payer's to take? An APPROVED applicant's lot is already theirs (a Pending
      // applicant on a resident for-sale lot must not block the approved buyer's deposit).
      if (current.status !== "Approved" && current.space_id && current.company_id) {
        const other = await otherPaidHolder(current.company_id, current.space_id, applicationId);
        if (other.error) return "retry";
        if (other.holder) {
          const r = await cancelAuthorization(paymentIntentId, "lot_conflict");
          if (r === "error") return "retry";
          if (r === "canceled") {
            await notifyApplicationLotConflict(session, applicationId, "Rent-to-Own deposit");
            if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef);
            return;
          }
        }
      }
    }
    // Before marking paid, so a retry (or the daily reconcile) knows the paid mark is this payment's —
    // also when it was already captured (e.g. by hand in Stripe). Not saved → change nothing, retry.
    if (sessionManual && assignedMarker && !(await setLotMarker(assignedMarker))) return "retry";
    // Aug 25 (per Mely): only real columns in the select (an unknown one made PostgREST reject the
    // whole update, so card deposits were never marked paid). Sep 26: + rent_to_own_deposit_paid_at.
    const { error } = await supabase
      .from("resident_applications")
      .update({
        rent_to_own_deposit_paid: true,
        rent_to_own_deposit_method: "Stripe",
        rent_to_own_deposit_paid_at: new Date().toISOString(),
      })
      .eq("id", applicationId);
    if (error) {
      if (manual && paymentIntentId && error.code === "23505" && /unique_active_rto_deposit_lot_hold/.test(error.message || "")) {
        // Another applicant's deposit took this lot at the same instant: nothing charged.
        const r = await cancelAuthorization(paymentIntentId, "lot_conflict");
        if (r === "error") return "retry";
        if (r === "canceled") {
          await notifyApplicationLotConflict(session, applicationId, "Rent-to-Own deposit");
          if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef);
          return;
        }
      }
      console.log("Error marking rent-to-own deposit paid:", error.message);
      return "retry"; // Stripe retries (the authorization, if any, is untouched)
    }
  }

  let capturedPi: Stripe.PaymentIntent | null = pi?.status === "succeeded" ? pi : null;
  if (manual && paymentIntentId) {
    const cap = await captureAuthorization(paymentIntentId);
    if (cap.result === "retry") return "retry"; // stays marked paid (and ours) — the retry captures
    if (cap.result === "gone") {
      await supabase
        .from("resident_applications")
        .update({ rent_to_own_deposit_paid: false, rent_to_own_deposit_paid_at: null })
        .eq("id", applicationId)
        .eq("rent_to_own_deposit_method", "Stripe");
      if (current.company_id) {
        await logSystemHealthIssue({
          companyId: current.company_id,
          issueType: "payment_failed",
          source: "stripe_webhook",
          message: `${current.full_name || "An applicant"}'s card authorization for the Rent-to-Own deposit ($${amount.toFixed(2)}) could not be captured (status: ${cap.pi?.status || "unknown"}), so nothing was charged and the deposit is NOT marked paid. Ask them to pay again. Stripe ${paymentIntentId}, session ${session.id}.`,
        });
      }
      return;
    }
    capturedPi = cap.pi;
  }

  if (sessionManual && capturedPi) {
    await logRvOnlinePayment({
      companyId: current.company_id || null,
      sourceId: session.id,
      description: "Rent-to-own deposit (online)",
      payerName: session.customer_details?.name || session.customer_details?.email || session.customer_email || null,
      amountCents: Number(capturedPi.amount_received || session.amount_total || 0),
      reference: paymentIntentId,
    });
  }
  // Oct 28 (review): the hold is released only now — the deposit is marked paid (and captured).
  if (lotHoldId && lotHoldRef) await releaseLotCheckoutHold(lotHoldId, lotHoldRef);

  console.log(`Rent-to-own deposit payment confirmed for application ${applicationId}.`);
  const notifyOk = !sessionManual || !paymentIntentId || (await claimStripeEvent(`rto:${paymentIntentId}:notify`, "lot_checkout")) === "new";
  if (notifyOk && current.company_id) {
    if (sessionManual && paymentIntentId) await finishStripeEvent(`rto:${paymentIntentId}:notify`, "lot_checkout", true);
    await supabase.from("resident_update_notifications").insert({
      company_id: current.company_id,
      resident_name: current.full_name || null,
      update_type: "rent_to_own_deposit_paid",
      message: `${current.full_name || "An applicant"} paid their Rent-to-Own deposit — $${amount.toFixed(2)}.`,
    });
  }
}

// Oct 28 (review): a lot payment could not be finished on this try (Stripe didn't answer, a capture
// failed, a database write failed). Stripe retries and the daily reconcile cron re-checks it — but the
// office is told right away (one open issue per session, not one per retry).
export async function logLotPaymentRetry(session: Stripe.Checkout.Session, kind: string) {
  try {
    const applicationId = session.metadata?.application_id;
    let companyId: string | null = session.metadata?.company_id || null;
    let name: string | null = null;
    if (applicationId) {
      const { data } = await supabase.from("resident_applications").select("company_id, full_name").eq("id", applicationId).maybeSingle();
      companyId = companyId || data?.company_id || null;
      name = data?.full_name || null;
    }
    if (!companyId) return;
    const { data: open } = await supabase
      .from("system_health_issues")
      .select("id")
      .eq("company_id", companyId)
      .eq("issue_type", "lot_payment_retry")
      .eq("resolved", false)
      .like("message", `%${session.id}%`)
      .limit(1);
    if (open && open.length > 0) return;
    await logSystemHealthIssue({
      companyId,
      issueType: "lot_payment_retry",
      source: "stripe_webhook",
      message: `The online ${kind} payment of ${name || "an applicant"} ($${((session.amount_total || 0) / 100).toFixed(2)}) could not be finished yet (the card authorization or the lot assignment is pending). Stripe will retry automatically and the daily lot-payment check re-checks it; if this stays open for more than a day, check Stripe → Payments for this session and the application. Stripe session ${session.id}.`,
    });
  } catch (e: any) {
    console.error("logLotPaymentRetry:", e?.message);
  }
}
