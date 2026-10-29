import { cardHoldPlaced } from "@/lib/marina/payments";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { createCheckrInvitation } from "@/lib/checkr";
import { recordMelyOSBillingCharge } from "@/lib/billingCharges";
import { checkAndCompleteRentToOwnPlan } from "@/lib/rentToOwnCompletion";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { notifyAdminBellOnce } from "@/lib/adminBell";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
import { RETURNED_ACH_FEE_CHARGE_TYPE, returnedPaymentFee, returnedFeeForReturn, insertReturnedFeeLine, FLAT_FOUR_RETURNED_FEE, billCompanyForReturnedPayment } from "@/lib/platformFee";
import { recordMarinaOnlinePayment, settleMarinaAchPayment, failMarinaAchPayment, returnMarinaOnlinePayment, returnMarinaPaymentRef } from "@/lib/marina/payments";
import { autopayBankFailed } from "@/lib/marina/autopay";
import { emailBoaterBankPaymentReturned } from "@/lib/marina/returnedFee";
import { isRvBankAutopayIntent, settleRvBankAutopay, failRvBankAutopay, markInvoicesProcessing, RV_AUTOPAY_SETUP_TYPE, RV_AUTOPAY_PI_TYPE } from "@/lib/rvBankAutopay";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import crypto from "crypto";
import { sendBankPaymentReturnedEmail } from "@/lib/sendBankPaymentReturnedEmail";
import { releaseLotCheckoutHold } from "@/lib/lotCheckoutHold";
import { handleApplicationFeePaid, handleRentToOwnDepositPaid, logLotPaymentRetry } from "@/lib/lotPaymentHandlers";
import { handleOccupantBackgroundCheckPaid } from "@/lib/occupantBackgroundCheck";
import { reduceParkOwedForRefund, parkOwedForPayment, confirmSettledRefundBilled } from "@/lib/parkPayoutLedger";
import { RV_CARD_AUTOPAY_TYPE } from "@/lib/rvCardAutopay";
import { markDisputeReopened } from "@/lib/rvBankAutopay";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;
// Sep 23 (per Mely — testing System Health in Stripe's Sandbox, found
// live: "No events deliveries found" because this webhook endpoint was
// only ever configured on the Live side of the Stripe dashboard, never
// in Sandbox — so no test-mode event, then or now, ever had anywhere to
// deliver to). Stripe's newer Sandboxes are fully separate environments
// with their own signing secret per webhook destination, even when both
// point at this exact same URL. Tries the Sandbox secret first (if a
// second destination gets added there), falling back to the Live one —
// so real production payments are never at risk from this change.
const sandboxWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET_SANDBOX as string | undefined;
// Oct 24 (security run): optional second endpoint for events on CONNECTED accounts (account.updated).
const connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET as string | undefined;

// Oct 21 (per Mely — security hardening): every event is claimed once before it is
// processed, so a retried or replayed Stripe event never records a payment twice.
export async function POST(req: Request) {
  const copy = req.clone();
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") as string;
  let ev: Stripe.Event | null = null;
  for (const secret of [webhookSecret, sandboxWebhookSecret, connectWebhookSecret]) {
    if (!secret || ev) continue;
    try { ev = stripe.webhooks.constructEvent(raw, sig, secret); } catch { /* try the next secret */ }
  }
  if (!ev) return handleWebhook(copy); // invalid signature: the handler answers 400 as before
  // Oct 29 (live-money audit M12): in production only LIVE events change money records. A test-mode
  // (Sandbox) event signed for this endpoint is acknowledged (so Stripe stops retrying) and ignored.
  // Outside production (preview / local) test events are processed as before.
  if (ev.livemode !== true && isProductionDeployment()) {
    console.warn(`stripe-webhook: ignored test-mode event ${ev.id} (${ev.type}) in production`);
    return NextResponse.json({ received: true, ignored: "test_mode_event_in_production" });
  }
  if ((await claimStripeEvent(ev.id, "web")) === "duplicate") {
    return NextResponse.json({ received: true, duplicate: true });
  }
  try {
    const res = await handleWebhook(copy);
    await finishStripeEvent(ev.id, "web", res.status < 500);
    return res;
  } catch (e) {
    await finishStripeEvent(ev.id, "web", false);
    throw e;
  }
}

function isProductionDeployment(): boolean {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === "production";
  return process.env.NODE_ENV === "production";
}

async function handleWebhook(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (liveErr: any) {
    let connectEv: Stripe.Event | null = null;
    if (connectWebhookSecret) { try { connectEv = stripe.webhooks.constructEvent(body, signature, connectWebhookSecret); } catch {} }
    if (connectEv) return handleConnectEvent(connectEv);
    if (sandboxWebhookSecret) {
      try {
        event = stripe.webhooks.constructEvent(body, signature, sandboxWebhookSecret);
      } catch (sandboxErr: any) {
        console.log("Webhook signature verification failed (both secrets):", liveErr.message, sandboxErr.message);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }
    } else {
      console.log("Webhook signature verification failed:", liveErr.message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
  }

  // Oct 28 (per Mely): an RV resident's bank (ACH) payment settles days after checkout. When the bank
  // confirms, the session is "paid" and it runs the SAME paid path below as a card payment (mark Paid,
  // fee/tax lines, receipt, admin notice, Daily Close ledger). Only RV invoice sessions — marina
  // sessions carry metadata.type and keep their own handler further down.
  const rvAchSettled =
    event.type === "checkout.session.async_payment_succeeded" &&
    isRvAchInvoiceSession(event.data.object as Stripe.Checkout.Session) &&
    (event.data.object as Stripe.Checkout.Session).payment_status === "paid";

  if (event.type === "checkout.session.completed" || rvAchSettled) {
    const session = event.data.object as Stripe.Checkout.Session;

    // Oct 15: marina boaters paying an invoice. Handled on its own and
    // returned right away so none of the RV-park logic below ever runs for it.
    // Oct 24 (per Mely): "Pay balance" — one payment for several invoices; each gets its share.
    if (session.metadata?.type === "marina_invoices") {
      const ach = session.metadata.payment_method === "ach";
      if ((session.payment_status === "paid" || (ach && session.payment_status === "unpaid")) && session.metadata.company_id) {
        const allocs = String(session.metadata.allocs || "").split(";").map((x) => x.split(":")).filter((x) => x.length === 2 && x[0] && Number(x[1]) > 0);
        for (let i = 0; i < allocs.length; i++) {
          await recordMarinaOnlinePayment({
            companyId: session.metadata.company_id,
            invoiceId: allocs[i][0],
            amount: Number(allocs[i][1]),
            reference: `online:${session.id}:${i + 1}`,
            method: ach ? "ach" : "card",
            pending: ach && session.payment_status !== "paid",
          });
        }
      }
      return NextResponse.json({ received: true });
    }
    if (session.metadata?.type === "marina_invoice" && session.metadata.hold === "1") {
      // Oct 27 (per Mely — like a hotel): a card HOLD while the resident rate is reviewed. Nothing is
      // charged yet: the booking is confirmed and the office later charges the resident or the regular price.
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (pi && session.metadata.company_id && session.metadata.invoice_id) {
        let intent: Stripe.PaymentIntent;
        try { intent = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] }); }
        catch { return NextResponse.json({ error: "retry" }, { status: 500 }); } // Stripe sends it again
        if (intent.status === "requires_capture") {
          const ch: any = intent.latest_charge;
          const before = ch?.payment_method_details?.card?.capture_before ? new Date(ch.payment_method_details.card.capture_before * 1000).toISOString() : null;
          const r = await cardHoldPlaced(session.metadata.company_id, session.metadata.invoice_id, pi, session.id, intent.amount / 100, Number(session.metadata.processing_fee_charged || 0) > 0, before);
          if (r === "error") return NextResponse.json({ error: "retry" }, { status: 500 });
          if (r === "no_booking") {
            // the booking is gone (expired or cancelled): release the guest's card
            await stripe.paymentIntents.cancel(pi).catch(() => null);
            await logSystemHealthIssue({ companyId: session.metadata.company_id, issueType: "card_hold", source: "stripe_webhook", message: `A card hold arrived for a booking that is no longer waiting (invoice ${session.metadata.invoice_id}); the hold was released.` }).catch(() => null);
          }
        }
      }
      return NextResponse.json({ received: true });
    }
    if (session.metadata?.type === "marina_invoice") {
      const ach = session.metadata.payment_method === "ach";
      // Oct 24: a bank (ACH) payment completes the session before the money clears
      // (payment_status "unpaid"); it is recorded as pending and settled by the
      // async_payment_succeeded event below.
      if ((session.payment_status === "paid" || (ach && session.payment_status === "unpaid")) && session.metadata.company_id && session.metadata.invoice_id) {
        await recordMarinaOnlinePayment({
          companyId: session.metadata.company_id,
          invoiceId: session.metadata.invoice_id,
          amount: Number(session.metadata.invoice_amount || 0),
          reference: `online:${session.id}`,
          method: ach ? "ach" : "card",
          pending: ach && session.payment_status !== "paid",
        });
      }
      return NextResponse.json({ received: true });
    }

    // Oct 8 (per Mely — Shifts & Daily Close): every online payment also goes to the RV-park ledger.
    if (session.payment_status === "paid") {
      const kind = session.metadata?.type;
      await logRvOnlinePayment({
        companyId: await resolveCompanyIdFromMetadata(session.metadata).catch(() => null),
        sourceId: session.id,
        description: kind === "application_fee" ? "Application fee (online)"
          : kind === "manual_reservation" ? "Reservation (online)"
          : kind === "rent_to_own_deposit" ? "Rent-to-own deposit (online)"
          : kind === "occupant_background_check" ? "Occupant background check (online)"
          : kind === "propane_fillup" || session.metadata?.productId ? "Propane (online)" : "Invoice payment (online)",
        payerName: session.customer_details?.name || session.customer_details?.email || session.customer_email || null,
        amountCents: Number(session.amount_total || 0),
        reference: typeof session.payment_intent === "string" ? session.payment_intent : null,
        parkShareCents: session.metadata?.park_share_cents !== undefined && Number.isFinite(Number(session.metadata.park_share_cents)) ? Number(session.metadata.park_share_cents) : null,
      });
    }

    // Oct 28 (per Mely): an RV resident saved a bank account for autopay (Checkout "setup" mode). The
    // portal saves it (/api/portal/bank-autopay "confirm"); nothing to charge or record here — and it
    // must never reach the invoice-payment path below (it carries resident_id).
    if (session.metadata?.type === RV_AUTOPAY_SETUP_TYPE) {
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "application_fee") {
      if ((await handleApplicationFeePaid(session)) === "retry") {
        await logLotPaymentRetry(session, "application fee");
        return NextResponse.json({ error: "retry" }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "manual_reservation") {
      // Oct 29 (live-money audit M3): a failed write answers 500 so Stripe sends it again (idempotent).
      if ((await handleManualReservationPaid(session)) === "retry") return NextResponse.json({ error: "retry" }, { status: 500 });
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "rent_to_own_deposit") {
      if ((await handleRentToOwnDepositPaid(session)) === "retry") {
        await logLotPaymentRetry(session, "Rent-to-Own deposit");
        return NextResponse.json({ error: "retry" }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "occupant_background_check") {
      // Oct 29 (live-money audit M3/M5): src/lib/occupantBackgroundCheck.ts.
      if ((await handleOccupantBackgroundCheckPaid(session)) === "retry") return NextResponse.json({ error: "retry" }, { status: 500 });
      return NextResponse.json({ received: true });
    }

    // Oct 23 (per Mely — Careers & Crew): the applicant paid their own background check →
    // send the Checkr invitation (customId "crew::<applicantId>").
    if (session.metadata?.type === "crew_background_check") {
      await handleCrewBackgroundCheckPaid(session);
      return NextResponse.json({ received: true });
    }

    // Oct 29 (live-money audit H2): a motor-home fill-up paid by scanning the staff's code (admin app,
    // create-fillup-checkout). Saved here — not only when the staff screen polls — once per session.
    if (session.metadata?.type === "propane_fillup") {
      if ((await handlePropaneFillupPaid(session)) === "retry") return NextResponse.json({ error: "retry" }, { status: 500 });
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.productId) {
      if ((await handlePropanePaid(session)) === "retry") return NextResponse.json({ error: "retry" }, { status: 500 }); // Oct 29 (M3)
      return NextResponse.json({ received: true });
    }

    // Oct 28 (per Mely): an RV resident paid by bank (ACH). Checkout completes before the money
    // clears (payment_status "unpaid"): the invoices become "Processing" — not owed again, not paid
    // yet. No fee/tax lines, no receipt. async_payment_succeeded (above) or _failed (below) finishes it.
    // Only invoices still "Pending" are touched, so a repeat delivery (or one arriving after the
    // bank already confirmed) changes nothing.
    if (isRvAchInvoiceSession(session) && session.payment_status !== "paid") {
      const achInvoiceIds = String(session.metadata?.invoice_ids || "").split(",").filter(Boolean);
      if (achInvoiceIds.length === 0) return NextResponse.json({ received: true });

      // Oct 28 (review): a late redelivery of this event must not undo what already happened. If the
      // bank already returned the payment (a returned-fee line for this session exists) or the
      // PaymentIntent is no longer "processing" (it failed or already settled), nothing is changed.
      const { data: returnedLine, error: returnedErr } = await supabase
        .from("resident_invoice_items")
        .select("id")
        .in("invoice_id", achInvoiceIds)
        .eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE)
        .like("description", `%${returnedFeeRef(session.id)}%`)
        .limit(1);
      if (returnedErr) return NextResponse.json({ error: "retry" }, { status: 500 });
      if (returnedLine && returnedLine.length > 0) return NextResponse.json({ received: true, skipped: "already_returned" });
      const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (piId) {
        let piStatus: string;
        try { piStatus = (await stripe.paymentIntents.retrieve(piId)).status; }
        catch { return NextResponse.json({ error: "retry" }, { status: 500 }); } // Stripe sends it again
        if (piStatus !== "processing") return NextResponse.json({ received: true, skipped: `payment_intent_${piStatus}` });
      }

      // Oct 28: also stamps processing_since (stuck-bank-payment check), if that column exists.
      const { rows: movedRows, error: processingErr } = await markInvoicesProcessing(achInvoiceIds);
      if (processingErr) {
        console.error("stripe-webhook: could not mark invoices Processing:", processingErr.message);
        return NextResponse.json({ error: "retry" }, { status: 500 }); // Stripe sends it again
      }
      if ((movedRows || []).length < achInvoiceIds.length) {
        // Some invoice was no longer Pending (paid another way, or changed by the office) while the
        // bank payment is on its way — the same balance may end up paid twice.
        const companyId = await resolveCompanyIdFromMetadata(session.metadata).catch(() => null);
        if (companyId) {
          await logSystemHealthIssue({
            companyId,
            residentId: session.metadata?.resident_id || null,
            issueType: "rv_possible_duplicate_payment",
            source: "stripe_webhook",
            message: `A resident's bank (ACH) payment of $${((session.amount_total || 0) / 100).toFixed(2)} started, but ${achInvoiceIds.length - (movedRows || []).length} of its ${achInvoiceIds.length} invoice(s) were no longer Pending (already paid or changed). If it settles, it may be a duplicate payment — review it for a refund. Stripe session ${session.id}.`,
          });
        }
      }
      return NextResponse.json({ received: true });
    }

    const residentId = session.metadata?.resident_id;
    const invoiceIdsRaw = session.metadata?.invoice_ids || "";
    const invoiceIds = invoiceIdsRaw.split(",").filter(Boolean);
    // Oct 28: a bank (ACH) payment's surcharge is labeled "Bank Transfer Fee" instead.
    const feeLabel = session.metadata?.payment_method === "ach" ? "Bank Transfer Fee" : "Card Processing Fee";
    const processingFeeCharged = Number(session.metadata?.processing_fee_charged || 0);
    const taxCharged = Number(session.metadata?.tax_charged || 0);
    const taxRatePercent = Number(session.metadata?.tax_rate_percent || 0);

    console.log("Payment completed for resident:", residentId);
    console.log("Marking invoice IDs as Paid:", invoiceIds);

    let chargesPaid: { label: string; amount: number }[] = [];

    // Oct 20 (security review — webhook idempotency): Stripe can deliver
    // the same event more than once (retries). There's no processed-events
    // table yet, so each step checks the invoice's own state instead: an
    // invoice that's already Paid never gets the tax/fee lines inserted
    // again, and if EVERY invoice was already Paid before this delivery,
    // the receipt email + admin notification are not sent a second time.
    let allInvoicesAlreadyPaid = false;

    if (invoiceIds.length > 0) {
      const { data: paidInvoices } = await supabase
        .from("resident_invoices")
        .select("id, total_amount, invoice_month, status")
        .in("id", invoiceIds);

      const alreadyPaidIds = new Set(
        (paidInvoices || []).filter((inv) => inv.status === "Paid").map((inv) => inv.id)
      );
      allInvoicesAlreadyPaid =
        (paidInvoices || []).length > 0 && invoiceIds.every((id) => alreadyPaidIds.has(id));
      // Oct 28 (review): invoices "Processing" = another bank payment (bank autopay, or a different
      // bank checkout) is in flight for them. This payment still settles them, but it may be a
      // duplicate — flagged below like alreadyPaidIds. Not when this event IS that bank payment
      // settling (async_payment_succeeded of an ACH session: its own invoices are Processing).
      const inFlightIds = rvAchSettled
        ? new Set<string>()
        : new Set((paidInvoices || []).filter((inv) => inv.status === "Processing").map((inv) => inv.id));
      if (inFlightIds.size > 0) {
        const companyId = await resolveCompanyIdFromMetadata(session.metadata).catch(() => null);
        if (companyId) {
          await logSystemHealthIssue({
            companyId,
            residentId: residentId || null,
            issueType: "rv_possible_duplicate_payment",
            source: "stripe_webhook",
            message: `An online ${session.metadata?.payment_method === "ach" ? "bank (ACH)" : "card"} payment of $${((session.amount_total || 0) / 100).toFixed(2)} arrived for ${inFlightIds.size} of ${invoiceIds.length} invoice(s) that already had a bank payment in flight ("Processing" — e.g. bank autopay): ${(paidInvoices || []).filter((inv) => inFlightIds.has(inv.id)).map((inv) => `${inv.invoice_month || "invoice"} (${inv.id})`).join(", ")}. They were marked Paid by this payment; if the bank payment also clears, it is a duplicate — review it for a refund in Stripe. Stripe session ${session.id}.`,
          });
        }
      }
      if (allInvoicesAlreadyPaid) {
        console.warn(
          `stripe-webhook: session ${session.id} — all invoices already Paid; treating as a duplicate delivery (no new line items, receipt or notification).`
        );
      }

      // Aug 20 (per Mely — "se puede mejor anadirles los dias por los que
      // se esta pagando los dias exactos... tal y como le muestra en la
      // aplicacion"): a bare "Invoice — August 2026" label doesn't tell
      // the resident WHAT they paid for — the exact day-range description
      // (e.g. "Prorated rent — 10 of 31 days") already exists per line
      // item on resident_invoice_items, the same one the applicant sees
      // when the invoice is first created. Break the receipt out into
      // those real line items instead of one generic per-invoice label,
      // falling back to the old generic label only if an invoice
      // somehow has no items (shouldn't normally happen).
      const { data: invoiceItemsRows } = await supabase
        .from("resident_invoice_items")
        .select("invoice_id, charge_type, description, amount")
        .in("invoice_id", invoiceIds);

      // Oct 28 (review — retry after a failed "mark Paid"): this payment's tax/fee lines may already be
      // on the primary invoice from the earlier attempt. Then they are not added (or counted) again.
      const primaryLines = (invoiceItemsRows || []).filter((it) => it.invoice_id === invoiceIds[0]);
      const hasLine = (type: string, amount: number) =>
        primaryLines.some((it) => it.charge_type === type && Math.abs(Number(it.amount || 0) - amount) < 0.01);
      const taxLineThere = taxCharged > 0 && hasLine("Sales Tax", taxCharged);
      const feeLineThere = processingFeeCharged > 0 && hasLine(feeLabel, processingFeeCharged);
      const linesAlreadyAdded = (taxCharged <= 0 || taxLineThere) && (processingFeeCharged <= 0 || feeLineThere) && (taxCharged > 0 || processingFeeCharged > 0);

      const itemsByInvoiceId = new Map<string, { description: string; amount: number }[]>();
      (invoiceItemsRows || []).forEach((item) => {
        const list = itemsByInvoiceId.get(item.invoice_id) || [];
        list.push({ description: item.description, amount: Number(item.amount) || 0 });
        itemsByInvoiceId.set(item.invoice_id, list);
      });

      (paidInvoices || []).forEach((inv) => {
        const items = itemsByInvoiceId.get(inv.id);
        if (items && items.length > 0) {
          items.forEach((item) => {
            chargesPaid.push({ label: item.description, amount: item.amount });
          });
        } else {
          chargesPaid.push({
            label: `Invoice — ${inv.invoice_month}`,
            amount: Number(inv.total_amount || 0),
          });
        }
      });
      if (taxCharged > 0 && !taxLineThere) {
        chargesPaid.push({ label: `Sales Tax (${taxRatePercent}%)`, amount: taxCharged });
      }
      if (processingFeeCharged > 0 && !feeLineThere) {
        chargesPaid.push({ label: feeLabel, amount: processingFeeCharged });
      }

      // Aug 5 (per Mely — real gap she caught: the invoice record never
      // showed the fee/tax Stripe actually charged): attach these as real
      // line items on the FIRST invoice being paid (the common case is
      // exactly one), then recompute that invoice's total_amount to
      // match what was truly collected — same safe "always recompute
      // from all items" pattern used everywhere else in this codebase.
      const primaryInvoiceId = invoiceIds[0];

      // Oct 28 (review): what Stripe collected must match the invoices it paid (their totals before
      // the fee/tax lines are added) + tax + fee. A charge added to an invoice after checkout started
      // would otherwise be marked Paid without having been collected. Checked once, on the first
      // delivery that pays the primary invoice.
      if (primaryInvoiceId && !alreadyPaidIds.has(primaryInvoiceId) && !linesAlreadyAdded) {
        const invoicesTotal = (paidInvoices || []).reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
        const expectedCents = Math.round((invoicesTotal + taxCharged + processingFeeCharged) * 100);
        const collectedCents = Number(session.amount_total || 0);
        if (Math.abs(expectedCents - collectedCents) > 2) {
          const companyId = await resolveCompanyIdFromMetadata(session.metadata).catch(() => null);
          if (companyId) {
            await logSystemHealthIssue({
              companyId,
              residentId: residentId || null,
              issueType: "rv_payment_amount_mismatch",
              source: "stripe_webhook",
              message: `An online invoice payment collected $${(collectedCents / 100).toFixed(2)} but the invoice(s) it paid now add up to $${(expectedCents / 100).toFixed(2)} (invoice totals + tax + fee). A charge was probably added or removed after checkout started. The invoice(s) were marked Paid — check them and bill or credit the difference. Stripe session ${session.id}.`,
            });
          }
        }
      }

      // Oct 20 (security review): skip if this invoice is already Paid —
      // a repeated delivery must not insert the tax/fee lines twice.
      if (
        primaryInvoiceId &&
        !alreadyPaidIds.has(primaryInvoiceId) &&
        (processingFeeCharged > 0 || taxCharged > 0)
      ) {
        if (taxCharged > 0 && !taxLineThere) {
          await supabase.from("resident_invoice_items").insert({
            invoice_id: primaryInvoiceId,
            charge_type: "Sales Tax",
            description: `Sales Tax (${taxRatePercent}%)`,
            amount: taxCharged,
          });
        }
        if (processingFeeCharged > 0 && !feeLineThere) {
          await supabase.from("resident_invoice_items").insert({
            invoice_id: primaryInvoiceId,
            charge_type: feeLabel,
            description: feeLabel,
            amount: processingFeeCharged,
          });
        }

        const { data: allItems } = await supabase
          .from("resident_invoice_items")
          .select("amount")
          .eq("invoice_id", primaryInvoiceId);
        const recomputedTotal = (allItems || []).reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );
        await supabase
          .from("resident_invoices")
          .update({ total_amount: recomputedTotal })
          .eq("id", primaryInvoiceId);
      }

      // Oct 28 (review): never silently overwrite an invoice that is already Paid. Pending and
      // Processing (bank clearing) invoices are flipped — and, as before, other unpaid statuses
      // (e.g. Written Off / Sent to Collections paid through the guest link), since the money arrived.
      const { error: invoiceUpdateError } = await supabase
        .from("resident_invoices")
        .update({ status: "Paid" })
        .in("id", invoiceIds)
        .neq("status", "Paid");

      // Any invoice that was already Paid before this payment arrived → possibly paid twice.
      if (alreadyPaidIds.size > 0) {
        const companyId = await resolveCompanyIdFromMetadata(session.metadata).catch(() => null);
        if (companyId) {
          await logSystemHealthIssue({
            companyId,
            residentId: residentId || null,
            issueType: "rv_possible_duplicate_payment",
            source: "stripe_webhook",
            message: `An online ${session.metadata?.payment_method === "ach" ? "bank (ACH)" : "card"} payment of $${((session.amount_total || 0) / 100).toFixed(2)} arrived for ${allInvoicesAlreadyPaid ? "invoice(s) that were ALL" : `${alreadyPaidIds.size} of ${invoiceIds.length} invoice(s) that were`} already Paid. This may be a duplicate payment — review it for a refund in Stripe. Stripe session ${session.id}.`,
          });
        }
      }

      if (invoiceUpdateError) {
        // Oct 28 (review): don't acknowledge — Stripe retries. The retry sees this payment's tax/fee
        // lines already on the invoice (linesAlreadyAdded above) and doesn't add them again.
        console.log("Error updating resident_invoices:", invoiceUpdateError.message);
        return NextResponse.json({ error: "retry" }, { status: 500 });
      } else {
        console.log("resident_invoices updated successfully.");
        if (residentId && !allInvoicesAlreadyPaid) {
          const { data: residentRow } = await supabase
            .from("resident_accounts")
            .select("company_id")
            .eq("id", residentId)
            .maybeSingle();
          if (residentRow?.company_id) {
            await checkAndCompleteRentToOwnPlan(residentId, residentRow.company_id);
          }
        }
      }
    }


    // Oct 20 (security review): no second receipt/notification for a
    // duplicate delivery (see allInvoicesAlreadyPaid above).
    if (residentId && !allInvoicesAlreadyPaid) {
      try {
        const { data: resident } = await supabase
          .from("resident_accounts")
          .select("full_name, email, company_id")
          .eq("id", residentId)
          .single();
        const { data: receiptCompany } = resident?.company_id
          ? await supabase.from("companies").select("company_name, address").eq("id", resident.company_id).maybeSingle()
          : { data: null as any };

        const { data: pending } = await supabase
          .from("resident_payments")
          .select("total_due, amount")
          .eq("resident_id", residentId)
          .in("status", ["Pending", "Late", "Partial"]);

        const remainingBalance = (pending || []).reduce(
          (sum, p) => sum + Number(p.total_due || p.amount || 0),
          0
        );

        if (resident?.email) {
          await sendReceiptEmail({
            toEmail: resident.email,
            residentName: resident.full_name || "Resident",
            amountPaid: (session.amount_total || 0) / 100,
            chargesPaid,
            receiptNumber:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.id,
            transactionId: session.id,
            paymentDate: new Date(session.created * 1000),
            remainingBalance,
            companyName: receiptCompany?.company_name || null, // Oct 29 (Low): the park's own name
            companyAddress: receiptCompany?.address || null,
          });
        } else {
          console.log("No email found for resident, skipping receipt.");
        }

        if (resident?.company_id) {
          const amountPaid = (session.amount_total || 0) / 100;
          const chargesLabel =
            chargesPaid.length > 0
              ? chargesPaid.map((c) => c.label).join(", ")
              : "rent/invoice";
          await supabase.from("resident_update_notifications").insert({
            company_id: resident.company_id,
            resident_id: residentId,
            resident_name: resident.full_name || null,
            update_type: "rent_payment",
            message: `${resident.full_name || "A resident"} paid $${amountPaid.toFixed(2)} (${chargesLabel}).`,
          });
        }
      } catch (emailErr) {
        console.error("Failed to send receipt email:", emailErr);
      }
    }
    // Oct 28: a settled RV bank payment is fully handled above.
    if (rvAchSettled) return NextResponse.json({ received: true });
  }

  // Sep 20 (per Mely — "un sistema que mida, corrija los errores...
  // detecte cualquier problema si hubo problema de pago"): the webhook
  // above only ever handled a SUCCESSFUL checkout — nothing logged when
  // a payment failed or a customer abandoned checkout entirely. These
  // two event types must also be enabled for this webhook endpoint in
  // the Stripe Dashboard (Developers → Webhooks → this endpoint → Select
  // events), same manual step as the Resend webhook's dashboard setup.
  //
  // Most checkout sessions in this codebase never set metadata.company_id
  // directly (only resident_id, application_id, or park) — resolves it
  // from whichever of those IS present instead of assuming one field.

  // Oct 8 (per Mely — Shifts & Daily Close): a full refund voids the online payment in the daily close;
  // a partial refund cannot be split automatically, so it is flagged in System Health for review.
  // Requires the event "charge.refunded" to be enabled on this webhook endpoint in the Stripe dashboard.
  // Oct 24: bank (ACH) payments clear or fail days after checkout.
  if (event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Oct 28 (per Mely): an RV resident's bank payment was returned by the bank.
    if (event.type === "checkout.session.async_payment_failed" && isRvAchInvoiceSession(session)) {
      return handleRvAchPaymentFailed(session);
    }
    if ((session.metadata?.type === "marina_invoice" || session.metadata?.type === "marina_invoices") && session.metadata.company_id) {
      if (event.type === "checkout.session.async_payment_succeeded") await settleMarinaAchPayment(session.metadata.company_id, `online:${session.id}`);
      else {
        const fee = await failMarinaAchPayment(session.metadata.company_id, `online:${session.id}`, "the bank declined the transfer", { paymentCreated: session.created, paymentRule: session.metadata.returned_fee_rule, paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null });
        // Oct 28 (per Mely): tell the boater (once per payment; the fee only if one was really added).
        const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
        const intent = piId ? await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] }).catch(() => null) : null;
        const ch: any = intent?.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
        await emailBoaterBankPaymentReturned({
          companyId: session.metadata.company_id, sessionId: session.id, reference: `online:${session.id}`,
          amount: (session.amount_total || 0) / 100,
          reasonCode: ch?.failure_code || intent?.last_payment_error?.code || null,
          reasonMessage: intent?.last_payment_error?.message || null,
          fee,
        });
      }
    }
    return NextResponse.json({ received: true });
  }

  // Oct 27 (per Mely): a refund made from MelyOS that the bank later rejects (closed card, bank
  // transfer refused): the money came back to MelyOS, so the request is flagged for the office and
  // MelyOS to fix the books by hand. Requires "charge.refund.updated" on this webhook endpoint.
  if (event.type === "charge.refund.updated") {
    const rf = event.data.object as Stripe.Refund;
    if (rf.status === "failed" && rf.metadata?.source === "melyos_marina_refund" && rf.metadata.company_id) {
      await supabase.from("marina_refunds").update({ status: "refund_failed", reject_note: `The bank rejected the refund (${rf.failure_reason || "no reason given"}).` })
        .eq("company_id", rf.metadata.company_id).eq("stripe_refund_id", rf.id).then(() => null, () => null);
      await logSystemHealthIssue({ companyId: rf.metadata.company_id, issueType: "refund_review", source: "stripe_webhook",
        message: `Refund ${rf.id} of $${(rf.amount / 100).toFixed(2)} FAILED at the bank (${rf.failure_reason || "no reason"}). The money is back in MelyOS's balance; the marina's payout was already reduced and the invoice was changed. Fix by hand: give the marina its share back and re-open/re-issue the invoice or refund another way.` }).catch(() => null);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
    // Refunds on this charge (to tell refunds made from MelyOS — which update the books themselves —
    // from ones made in the Stripe dashboard).
    // Review M1: if Stripe can't be asked right now, answer 500 (Stripe retries) — never guess that a
    // refund came from the dashboard.
    let refundsOnCharge: Stripe.Refund[] = [];
    let s: Stripe.Checkout.Session | undefined;
    if (pi) {
      try {
        refundsOnCharge = (await stripe.refunds.list({ charge: charge.id, limit: 100 })).data;
        s = (await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 })).data[0];
      } catch (e: any) {
        console.error("charge.refunded: could not read refunds/session:", e?.message);
        return NextResponse.json({ error: "retry" }, { status: 500 });
      }
    }
    // Oct 24 (per Mely): marina invoice payments refunded in Stripe.
    if (pi) {
      try {
        // Oct 27: refunds made from MelyOS (Invoices → Refund) update the books themselves. Decided per
        // refund: only when EVERY refund on this charge came from MelyOS is there nothing to do here.
        const fromMelyos = refundsOnCharge.length > 0 && refundsOnCharge.every((r) => r.metadata?.source === "melyos_marina_refund");
        if (s && (s.metadata?.type === "marina_invoice" || s.metadata?.type === "marina_invoices") && s.metadata.company_id && fromMelyos) { /* nothing to do */ }
        else if (s && (s.metadata?.type === "marina_invoice" || s.metadata?.type === "marina_invoices") && s.metadata.company_id) {
          if (charge.refunded) await returnMarinaOnlinePayment(s.metadata.company_id, s.id, "Refunded in Stripe");
          else await logSystemHealthIssue({ companyId: s.metadata.company_id, issueType: "marina_online_payment_returned", source: "stripe_webhook", message: `Partial refund of $${(Number(charge.amount_refunded || 0) / 100).toFixed(2)} on a marina online payment. The invoice still shows the full amount paid — record the refund on the invoice.` });
        }
        // Oct 26: marina autopay charges (no checkout session) — metadata is on the charge.
        if (!s && charge.metadata?.type === "marina_autopay" && charge.metadata.company_id && !fromMelyos) {
          if (charge.refunded) await returnMarinaPaymentRef(charge.metadata.company_id, `autopay:${pi}`, "Refunded in Stripe");
          else await logSystemHealthIssue({ companyId: charge.metadata.company_id, issueType: "marina_online_payment_returned", source: "stripe_webhook", message: `Partial refund of $${(Number(charge.amount_refunded || 0) / 100).toFixed(2)} on a marina autopay charge. Record the refund on the invoice.` });
        }
      } catch (e: any) { console.error("marina refund sync:", e?.message); }
    }
    if (pi) {
      const { data: rows } = await supabase.from("rv_shift_payments").select("id, company_id, amount, payer_name")
        .eq("source_type", "stripe_online").eq("reference", pi).is("voided_at", null);
      for (const row of rows || []) {
        if (charge.refunded) {
          await supabase.from("rv_shift_payments").update({
            voided_at: new Date().toISOString(), void_reason: "Refunded in Stripe", voided_by_name: "Stripe",
          }).eq("id", row.id);
        } else {
          // Refunds issued from MelyOS Daily Close are already recorded in rv_refunds — nothing to review.
          const { data: ours } = await supabase.from("rv_refunds").select("id").eq("payment_intent", pi).limit(1);
          if (ours && ours.length) continue;
          await logSystemHealthIssue({
            companyId: row.company_id, issueType: "shift_ledger_review", source: "stripe_webhook",
            message: `Partial refund of $${(Number(charge.amount_refunded || 0) / 100).toFixed(2)} on an online payment of $${Number(row.amount).toFixed(2)} (${row.payer_name || "unknown payer"}). Daily Close still shows the full amount — review it.`,
          });
        }
      }
    }
    // Oct 29 (live-money audit M2): an RV payment FULLY refunded from the Stripe dashboard (not from
    // MelyOS Daily Close, which updates the books itself) — the record it paid is reopened / marked
    // refunded and the office is told. Each step only changes rows still in the "paid" state, so a
    // repeated event changes nothing.
    const fromMelyosRv = refundsOnCharge.length > 0 && refundsOnCharge.every((r) => r.metadata?.source === "melyos_daily_close" || r.metadata?.source === "melyos_marina_refund");
    // Review M3: canceling an uncaptured authorization (lot checkouts we released ourselves) also
    // sends charge.refunded — nothing was ever collected, so it is not a dashboard refund.
    const neverCaptured = charge.captured === false || Number(charge.amount_captured || 0) === 0;
    if (pi && charge.refunded && !fromMelyosRv && !neverCaptured) {
      try {
        await handleRvFullRefundOutsideMelyos(charge, pi, s || null);
      } catch (e: any) {
        console.error("rv refund sync:", e?.message);
        return NextResponse.json({ error: "retry" }, { status: 500 });
      }
    }
  }

  // Oct 20 (per Mely — "solo se cobra por un charge back y van a MelyOS"):
  // when a customer disputes a card payment, Stripe charges MelyOS (the
  // platform) a $15 dispute fee. Record it as a charge the park owes MelyOS
  // (Settings → Billing → Charges / MelyOS Fees Owed) and alert in System
  // Health with the details. Requires the event "charge.dispute.created" to
  // be enabled on this webhook endpoint in the Stripe dashboard.
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const disputeFee = 15;
    try {
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
      let companyId: string | null = null;
      const destination = charge?.transfer_data?.destination;
      const destId = typeof destination === "string" ? destination : destination?.id;
      if (destId) {
        const { data } = await supabase.from("park_settings").select("company_id").eq("stripe_connect_account_id", destId).maybeSingle();
        companyId = data?.company_id || null;
      }
      if (!companyId && charge?.payment_intent) {
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
        const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
        companyId = await resolveCompanyIdFromMetadata(sessions.data[0]?.metadata || charge.metadata);
      }
      const amount = (Number(dispute.amount || 0) / 100).toFixed(2);
      const who = charge?.billing_details?.name || charge?.billing_details?.email || "a customer";
      // Oct 28 (review): a bank (ACH) payment can be disputed too — say so instead of "card".
      const isBank = charge?.payment_method_details?.type === "us_bank_account";
      if (companyId) {
        const source = `Stripe dispute ${dispute.id}`;
        const { data: existing } = await supabase.from("melyos_billing_charges").select("id").eq("source", source).limit(1);
        if (!existing || existing.length === 0) {
          await recordMelyOSBillingCharge({
            companyId,
            chargeType: "Chargeback fee",
            source,
            description: `${isBank ? "Bank (ACH) payment dispute" : "Card dispute (chargeback)"} by ${who} on a $${amount} payment. Stripe charges a $${disputeFee.toFixed(2)} fee for every dispute.`,
            amount: disputeFee,
            markup: 0,
          });
          await logSystemHealthIssue({
            companyId,
            issueType: "chargeback",
            source: "stripe_webhook",
            message: isBank
              ? `${who} disputed a $${amount} bank (ACH) payment with their bank (reason: ${dispute.reason || "not given"}). A $${disputeFee} dispute fee was added to MelyOS Fees Owed. Bank disputes usually can't be won — the bank takes the money back.`
              : `${who} disputed a $${amount} card payment with their bank (reason: ${dispute.reason || "not given"}). A $${disputeFee} chargeback fee was added to MelyOS Fees Owed. Respond in Stripe before ${dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString("en-US") : "the deadline"} to try to win it.`,
          });
        }
        // Oct 29 (per Mely — Notification Preferences): the admin BELL too (critical — always shown),
        // once per dispute, scoped to this company. Best-effort; never blocks the steps here.
        await notifyAdminBellOnce({
          companyId, onceKey: `bell:dispute:${dispute.id}`, updateType: "payment_dispute", ref: dispute.id,
          residentName: who,
          message: `${who} disputed a $${amount} ${isBank ? "bank (ACH)" : "card"} payment (reason: ${dispute.reason || "not given"}). See System Health for what to do. Ref ${dispute.id}.`,
        });
        // A bank (ACH) dispute is often LOST the moment it opens: reopen the RV invoices it paid.
        if (isBank && dispute.status === "lost" && charge?.payment_intent) {
          const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
          const ss = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 }).catch(() => null);
          const s0 = ss?.data[0];
          if (s0 && isRvInvoiceSession(s0)) await reopenRvInvoicesForLostBankDispute(s0, dispute, companyId);
          // Oct 29 (M2): bank autopay payments have no checkout session — the invoices are on the charge.
          else if (!s0 && isRvAutopayCharge(charge)) await reopenRvInvoicesForLostDisputeMeta(charge.metadata, dispute, companyId);
        }
      } else {
        console.error("charge.dispute.created: could not find the company for dispute", dispute.id);
      }
    } catch (err: any) {
      console.error("charge.dispute.created handling failed:", err?.message);
      // Oct 29 (live-money audit M2): every step above is idempotent — let Stripe retry.
      return NextResponse.json({ error: "retry" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Oct 20 (per Mely — "eso son sus clientes, no los de MelyOS"): when a
  // dispute is LOST, the customer's bank keeps the whole payment and Stripe
  // takes it from MelyOS (the platform). So:
  //  - the park's share is taken back from the park's transfer (like a refund);
  //  - everything MelyOS had kept from that payment (card processing fee,
  //    its part of an application fee, background check cost — Stripe's
  //    application_fee_amount) is added to the park's MelyOS Fees Owed.
  // The $15 dispute fee was already charged when the dispute opened.
  // If the dispute is WON, Stripe returns the money and nothing else happens.
  // Requires the event "charge.dispute.closed" on this webhook endpoint.
  if (event.type === "charge.dispute.closed") {
    const dispute = event.data.object as Stripe.Dispute;
    if (dispute.status !== "lost") return NextResponse.json({ received: true });
    try {
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
      const destination = charge?.transfer_data?.destination;
      const destId = typeof destination === "string" ? destination : destination?.id;
      let companyId: string | null = null;
      if (destId) {
        const { data } = await supabase.from("park_settings").select("company_id").eq("stripe_connect_account_id", destId).maybeSingle();
        companyId = data?.company_id || null;
      }
      if (!companyId && charge?.payment_intent) {
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
        const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
        companyId = await resolveCompanyIdFromMetadata(sessions.data[0]?.metadata || charge.metadata);
      }
      if (!companyId || !charge) {
        console.error("charge.dispute.closed: could not find the company for dispute", dispute.id);
        return NextResponse.json({ received: true });
      }
      // Oct 28 (review): bank (ACH) disputes are labeled as such, not as card disputes.
      const disputeWord = charge.payment_method_details?.type === "us_bank_account" ? "bank (ACH) payment dispute" : "card dispute";
      // Oct 24 (per Mely): a lost dispute on a marina payment reopens the invoice(s).
      if (charge?.payment_intent) {
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
        const ss = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 }).catch(() => null);
        const s0 = ss?.data[0];
        if (s0 && (s0.metadata?.type === "marina_invoice" || s0.metadata?.type === "marina_invoices") && s0.metadata.company_id) {
          await returnMarinaOnlinePayment(s0.metadata.company_id, s0.id, `Lost card dispute ${dispute.id}`);
        }
        // Oct 28 (review): a lost bank (ACH) dispute on an RV resident's invoice payment reopens the invoices.
        // Oct 29 (live-money audit M2): a lost CARD dispute too — the bank took the money back either way.
        if (s0 && isRvInvoiceSession(s0)) {
          await reopenRvInvoicesForLostBankDispute(s0, dispute, companyId);
        }
        // Oct 29 (M2): RV autopay (card or bank) has no checkout session — the invoices are on the charge.
        if (!s0 && isRvAutopayCharge(charge)) {
          await reopenRvInvoicesForLostDisputeMeta(charge.metadata, dispute, companyId);
        }
        // Oct 26: autopay charges have no checkout session; the metadata is on the charge.
        if (!s0 && charge.metadata?.type === "marina_autopay" && charge.metadata.company_id) {
          await returnMarinaPaymentRef(charge.metadata.company_id, `autopay:${piId}`, `Lost card dispute ${dispute.id}`);
        }
      }
      const source = `Stripe lost dispute ${dispute.id}`;
      const { data: done } = await supabase.from("melyos_billing_charges").select("id").eq("source", source).limit(1);
      // Review (Low): each charge below is deduped by its own source, so a retry after a failure in
      // the middle still records the rest (it used to stop here and lose the park-share charge).
      const melyosPartBilled = !!(done && done.length);

      const who = charge.billing_details?.name || charge.billing_details?.email || "a customer";
      const totalCents = Number(dispute.amount || 0);
      let melyosCents = Math.min(Number(charge.application_fee_amount || 0), totalCents);
      let parkCents = Math.max(totalCents - melyosCents, 0);
      // Oct 29 (live-money audit H1): a payment charged WITHOUT the park's payout account — the park's
      // share (park_payout_ledger) never reached the park. While MelyOS still holds it, the ledger is
      // lowered instead of billing the park; once it was paid out by hand, it is billed as before.
      const disputePi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id || null;
      const unsplitOwed = !charge.transfer && disputePi ? await parkOwedForPayment(disputePi) : null;
      let ledgerNote = "";
      let settledLedger = false;
      if (unsplitOwed !== null && disputePi) {
        parkCents = Math.min(Math.round(unsplitOwed * 100), totalCents);
        melyosCents = totalCents - parkCents;
        const r = await reduceParkOwedForRefund(disputePi, parkCents / 100, `Lost ${disputeWord} ${dispute.id}`, `dispute:${dispute.id}`);
        if (r.status === "reduced") { ledgerNote = `MelyOS still held the park's share ($${(parkCents / 100).toFixed(2)}) — it was taken off "owed to the park" instead of being billed.`; parkCents = 0; }
        else if (r.status === "settled") { parkCents = Math.round(r.owed * 100); settledLedger = true; }
        else if (r.status === "error") throw new Error("could not update park_payout_ledger"); // retried (never bill the park for money MelyOS still holds)
      }

      // 1) MelyOS's own part of the payment → owed by the park.
      if (melyosCents > 0 && !melyosPartBilled) {
        await recordMelyOSBillingCharge({
          companyId,
          chargeType: "Lost chargeback (MelyOS fees)",
          source,
          description: `Lost ${disputeWord} by ${who} on a $${(totalCents / 100).toFixed(2)} payment. The bank kept the whole payment, including the fees MelyOS had kept from it (card processing fee and, if any, application / background check fees): $${(melyosCents / 100).toFixed(2)}.`,
          amount: melyosCents / 100,
          markup: 0,
        });
      }

      // Oct 27 (per Mely): since June 2025 Stripe also charges $15 when someone RESPONDS to a dispute
      // (it comes back only if the dispute is won). Lost after responding → the park owes it too.
      if (Number((dispute as any).evidence_details?.submission_count || 0) > 0) {
        const src2 = `Stripe dispute response ${dispute.id}`;
        const { data: had } = await supabase.from("melyos_billing_charges").select("id").eq("source", src2).limit(1);
        if (!had?.length) {
          await recordMelyOSBillingCharge({
            companyId, chargeType: "Chargeback response fee", source: src2,
            description: `The ${disputeWord} by ${who} was answered with evidence and lost. Stripe charges $15.00 to respond to a dispute and returns it only when the dispute is won.`,
            amount: 15, markup: 0,
          });
        }
      }

      // 2) The park's own share → taken back from the park's transfer.
      let reversalNote = "";
      const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id;
      if (parkCents > 0) {
        if (transferId) {
          try {
            await stripe.transfers.createReversal(
              transferId,
              { amount: parkCents, metadata: { reason: "lost_dispute", dispute_id: dispute.id } },
              { idempotencyKey: `dispute-rev-${dispute.id}` }
            );
          } catch (e: any) {
            reversalNote = e?.message || "reversal failed";
          }
        } else {
          reversalNote = "no transfer found on this payment";
        }
        // Review (Low): deduped by its own source, so a retry never bills the park's share twice.
        const { data: hadParkShare } = reversalNote ? await supabase.from("melyos_billing_charges").select("id").eq("company_id", companyId).eq("source", `${source} (park share)`).limit(1) : { data: [] as any[] };
        if (reversalNote && !hadParkShare?.length) {
          // Couldn't take it back automatically → record it as owed instead.
          await recordMelyOSBillingCharge({
            companyId,
            chargeType: "Lost chargeback (park share)",
            source: `${source} (park share)`,
            description: `Lost ${disputeWord} by ${who}: the park's share of $${(parkCents / 100).toFixed(2)} could not be taken back from the payout automatically (${reversalNote}).`,
            amount: parkCents / 100,
            markup: 0,
          });
        }
        // Review M2: a settled (paid-out) unsplit row is counted only once the park was billed.
        if (settledLedger && disputePi && reversalNote) {
          const { data: billedShare } = await supabase.from("melyos_billing_charges").select("id").eq("company_id", companyId).eq("source", `${source} (park share)`).limit(1);
          if (!billedShare?.length) throw new Error("could not bill the park's share of the lost dispute"); // retried
          await confirmSettledRefundBilled(disputePi, parkCents / 100, `Lost ${disputeWord} ${dispute.id}`, `dispute:${dispute.id}`);
        }
      }

      await logSystemHealthIssue({
        companyId,
        issueType: "chargeback",
        source: "stripe_webhook",
        message: `The ${disputeWord} by ${who} on a $${(totalCents / 100).toFixed(2)} payment was LOST. ${ledgerNote ? `${ledgerNote} ` : ""}${parkCents > 0 ? (reversalNote ? `The park's share ($${(parkCents / 100).toFixed(2)}) was added to MelyOS Fees Owed.` : `The park's share ($${(parkCents / 100).toFixed(2)}) was taken back from the park's payout.`) : ""} ${melyosCents > 0 ? `MelyOS's fees on that payment ($${(melyosCents / 100).toFixed(2)}) were added to MelyOS Fees Owed.` : ""}`.trim(),
      });
    } catch (err: any) {
      console.error("charge.dispute.closed handling failed:", err?.message);
      // Oct 29 (live-money audit M2): every step above is idempotent — let Stripe retry.
      return NextResponse.json({ error: "retry" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    // Oct 28 (review): RV invoice checkouts now expire after 31 minutes and earlier ones are closed on
    // purpose when a new one starts — that is not a failed payment.
    if (isRvInvoiceSession(session)) return NextResponse.json({ received: true });
    // Oct 28: an abandoned "save my bank account for autopay" page is not a failed payment either.
    if (session.metadata?.type === RV_AUTOPAY_SETUP_TYPE) return NextResponse.json({ received: true });
    // Oct 28 (per Mely): a lot checkout ended unpaid — free its lot hold (only if the hold still
    // belongs to THIS session; a newer checkout by the same person keeps its own).
    if (session.metadata?.lot_id && session.metadata?.lot_hold_ref) {
      await releaseLotCheckoutHold(session.metadata.lot_id, session.metadata.lot_hold_ref, session.id);
    }
    // Oct 28 (review): replaced by a newer checkout of the same person — not a failed payment.
    if (session.metadata?.superseded === "1") return NextResponse.json({ received: true });
    const email = session.customer_details?.email || session.customer_email || "unknown";
    const amount = ((session.amount_total || 0) / 100).toFixed(2);
    const companyId = await resolveCompanyIdFromMetadata(session.metadata);
    if (companyId) {
      await logSystemHealthIssue({
        companyId,
        issueType: "payment_failed",
        message: `Checkout session expired without completing — ${email}, $${amount} (${session.metadata?.type || "unknown charge type"}).`,
        source: "stripe_webhook",
      });
    }
  }

  // Oct 26: marina autopay by bank — settle or fail as soon as Stripe tells us (the daily
  // reconcile in /api/cron/marina-autopay does the same if these events are not sent).
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    if (intent.metadata?.type === "marina_autopay" && intent.metadata.company_id) {
      if (event.type === "payment_intent.succeeded") await settleMarinaAchPayment(intent.metadata.company_id, `autopay:${intent.id}`);
      else await autopayBankFailed(intent.metadata.company_id, intent.id, intent.last_payment_error?.message || "the payment failed", { paymentCreated: intent.created, paymentRule: intent.metadata?.returned_fee_rule });
      return NextResponse.json({ received: true });
    }
    // Oct 28 (per Mely): RV resident autopay by bank (src/lib/rvBankAutopay.ts). Only intents with
    // metadata.type "rv_autopay" + source "autopay" + payment_method "ach" + resident_id + invoice_ids
    // and a us_bank_account method — never a marina intent ("marina_autopay", handled just above and
    // returned) and never a one-time portal checkout (its PaymentIntent has no metadata).
    // A failed write answers 500 so Stripe retries; both handlers are idempotent.
    if (isRvBankAutopayIntent(intent)) {
      const r = event.type === "payment_intent.succeeded" ? await settleRvBankAutopay(intent) : await failRvBankAutopay(intent);
      return r.ok ? NextResponse.json({ received: true, ...(r.detail ? { detail: r.detail } : {}) }) : NextResponse.json({ error: "retry" }, { status: 500 });
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
    // Oct 29 (M1): card autopay failures are handled (and told to System Health) by process-autopay.
    if (intent.metadata?.type === RV_CARD_AUTOPAY_TYPE) return NextResponse.json({ received: true });
    const amount = ((intent.amount || 0) / 100).toFixed(2);
    const companyId = await resolveCompanyIdFromMetadata(intent.metadata);
    if (companyId) {
      await logSystemHealthIssue({
        companyId,
        issueType: "payment_failed",
        message: `Payment failed — $${amount}. ${intent.last_payment_error?.message || "No further detail from Stripe."}`,
        source: "stripe_webhook",
      });
    }
  }

  return NextResponse.json({ received: true });
}

// Oct 29: moved out of handleWebhook (unchanged) so the refund/dispute helpers below can use it.
async function resolveCompanyIdFromMetadata(metadata: Stripe.Metadata | null | undefined): Promise<string | null> {
  if (!metadata) return null;
  if (metadata.company_id) return metadata.company_id;
  if (metadata.companyId) return metadata.companyId;
  if (metadata.lot_order_id) {
    const { data } = await supabase.from("reservations").select("company_id").eq("lot_order_id", metadata.lot_order_id).maybeSingle();
    if (data?.company_id) return data.company_id;
  }
  if (metadata.resident_id) {
    const { data } = await supabase.from("resident_accounts").select("company_id").eq("id", metadata.resident_id).maybeSingle();
    if (data?.company_id) return data.company_id;
  }
  if (metadata.application_id) {
    const { data } = await supabase.from("resident_applications").select("company_id").eq("id", metadata.application_id).maybeSingle();
    if (data?.company_id) return data.company_id;
  }
  if (metadata.park) {
    const { data } = await supabase.from("companies").select("id").eq("park_id", metadata.park).maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

// Oct 28 (per Mely): a resident-portal invoice payment (create-checkout-session) made by bank (ACH).
// Those sessions have no metadata.type (marina, propane, applications… all set one or productId).
function isRvAchInvoiceSession(session: Stripe.Checkout.Session): boolean {
  return isRvInvoiceSession(session) && session.metadata?.payment_method === "ach";
}
// Any RV resident-invoice session (portal Pay Now or the guest invoice link), card or bank.
function isRvInvoiceSession(session: Stripe.Checkout.Session): boolean {
  const m = session.metadata || {};
  return !m.type && !m.productId && !!m.resident_id && !!m.invoice_ids;
}

const RETURNED_ACH_FEE_TYPE = RETURNED_ACH_FEE_CHARGE_TYPE;
// The reference written into the returned-fee line's description (last 10 chars of the session id).
function returnedFeeRef(sessionId: string) {
  return sessionId.slice(-10);
}

// Oct 28 (per Mely): the bank returned (bounced) an RV resident's ACH payment. The invoices go back
// from "Processing" to "Pending" (owed again), Stripe's $4 return fee is added once as a line on the
// first reopened invoice (total recomputed from its items), and System Health tells the office.
// Idempotent: only "Processing" invoices are reopened, and the fee line carries a reference to this
// session — if it is already there, nothing else is done (no second fee, no second alert).
async function handleRvAchPaymentFailed(session: Stripe.Checkout.Session) {
  const residentId = session.metadata?.resident_id || "";
  const invoiceIds = String(session.metadata?.invoice_ids || "").split(",").filter(Boolean);
  const ref = returnedFeeRef(session.id);
  // Oct 28 (per Mely): the company's own returned-payment fee rule (Florida standard or its fee
  // schedule — src/lib/returnedFeeRules.ts), on the INVOICE amount: what was collected minus the bank
  // transfer fee and the sales tax this payment added.
  const { data: feeResident } = await supabase.from("resident_accounts").select("company_id").eq("id", residentId).maybeSingle();
  const feeCompanyId = feeResident?.company_id || null;
  const { data: feeCompany } = feeCompanyId ? await supabase.from("companies").select("company_name").eq("id", feeCompanyId).maybeSingle() : { data: null as any };
  // Oct 28 (review): the rule frozen on this payment when it was made (session metadata), else the
  // fee disclosed at that time (older → flat $4); never a higher current rule.
  const invoiceAmountForFee = Math.max((session.amount_total || 0) / 100 - Number(session.metadata?.processing_fee_charged || 0) - Number(session.metadata?.tax_charged || 0), 0);
  const returnFee = (await returnedFeeForReturn({
    kind: "rv", companyId: feeCompanyId, companyName: feeCompany?.company_name || null, invoiceAmount: invoiceAmountForFee,
    paymentRule: session.metadata?.returned_fee_rule, paymentCreated: session.created,
  })) || returnedPaymentFee(FLAT_FOUR_RETURNED_FEE, invoiceAmountForFee, feeCompany?.company_name || null); // RV: $4 was always disclosed

  const { error: reopenErr } = await supabase
    .from("resident_invoices")
    .update({ status: "Pending" })
    .in("id", invoiceIds)
    .eq("status", "Processing");
  if (reopenErr) {
    console.error("stripe-webhook: could not reopen returned ACH invoices:", reopenErr.message);
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }

  const { data: existingFee, error: feeLookupErr } = await supabase
    .from("resident_invoice_items")
    .select("id, invoice_id, amount")
    .in("invoice_id", invoiceIds)
    .eq("charge_type", RETURNED_ACH_FEE_TYPE)
    .like("description", `%${ref}%`)
    .limit(1);
  if (feeLookupErr) return NextResponse.json({ error: "retry" }, { status: 500 });

  const { data: invoices } = await supabase
    .from("resident_invoices")
    .select("id, status, invoice_month, company_id")
    .in("id", invoiceIds);
  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();

  // Oct 28 (review — retry-safe): the fee line is added once; the invoice total is recomputed from
  // its items every time the line exists, so a failed total update is fixed by Stripe's retry.
  let feeInvoice: { id: string; invoice_month?: string | null } | null = null;
  if (existingFee && existingFee.length > 0) {
    const inv = (invoices || []).find((i) => i.id === existingFee[0].invoice_id);
    feeInvoice = { id: existingFee[0].invoice_id, invoice_month: inv?.invoice_month };
    // A retry: the line already added is what counts (settings may have changed since).
    const was = Number((existingFee[0] as any).amount) || 0;
    if (was > 0 && Math.abs(was - returnFee.total) > 0.005) {
      returnFee.total = was;
      returnFee.melyosShare = Math.min(was, returnFee.melyosShare);
      returnFee.companyShare = Math.round((was - returnFee.melyosShare) * 100) / 100;
    }
  } else {
    // The first invoice of this payment that is open again (an invoice the office already marked
    // paid by hand is left alone — the fee would never be collected there).
    const target = invoiceIds
      .map((id) => (invoices || []).find((inv) => inv.id === id))
      .find((inv) => inv?.status === "Pending");
    if (target) {
      const { error: insertErr } = await insertReturnedFeeLine({
        invoice_id: target.id,
        charge_type: RETURNED_ACH_FEE_TYPE,
        description: `${returnFee.description} (ref ${ref})`,
        amount: returnFee.total,
        melyos_share: returnFee.melyosShare, // frozen now
      });
      if (insertErr) {
        console.error("stripe-webhook: could not add returned ACH fee:", insertErr.message);
        return NextResponse.json({ error: "retry" }, { status: 500 });
      }
      feeInvoice = { id: target.id, invoice_month: target.invoice_month };
    }
  }

  if (feeInvoice) {
    const { data: allItems, error: itemsErr } = await supabase
      .from("resident_invoice_items")
      .select("amount")
      .eq("invoice_id", feeInvoice.id);
    if (itemsErr) return NextResponse.json({ error: "retry" }, { status: 500 });
    const recomputedTotal = (allItems || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const { error: totalErr } = await supabase.from("resident_invoices").update({ total_amount: recomputedTotal }).eq("id", feeInvoice.id);
    if (totalErr) {
      console.error("stripe-webhook: could not update total after returned ACH fee:", totalErr.message);
      return NextResponse.json({ error: "retry" }, { status: 500 });
    }
  }

  const companyId = resident?.company_id || (invoices || [])[0]?.company_id || null;
  if (!companyId) {
    console.error("stripe-webhook: returned ACH payment with no company for session", session.id);
    return NextResponse.json({ received: true });
  }
  // Oct 28 (per Mely — new model): MelyOS bills the park its fixed charge for this returned payment
  // (once per PaymentIntent; whether or not the resident pays the fee).
  await billCompanyForReturnedPayment({
    companyId, kind: "rv", payerName: resident?.full_name || null, amount: (session.amount_total || 0) / 100,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
  });

  // Oct 29 (per Mely — Notification Preferences): also the admin BELL (critical — always shown),
  // once per payment (PaymentIntent, else session), scoped to this company. Best-effort.
  {
    const piRef = (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id) || session.id;
    await notifyAdminBellOnce({
      companyId, onceKey: `bell:ach_returned:${piRef}`, updateType: "ach_payment_returned", ref: piRef,
      residentId: residentId || null, residentName: resident?.full_name || null,
      message: `${resident?.full_name || "A resident"}'s bank (ACH) payment of $${((session.amount_total || 0) / 100).toFixed(2)} was returned by the bank. ${invoiceIds.length === 1 ? "The invoice is" : "The invoices are"} owed again — see System Health. Ref ${piRef}.`,
    });
  }

  // One System Health issue per returned payment (a retry after a failure above doesn't add another).
  const { data: alreadyLogged } = await supabase
    .from("system_health_issues")
    .select("id")
    .eq("company_id", companyId)
    .eq("issue_type", "rv_bank_payment_returned")
    .like("message", `%${session.id}%`)
    .limit(1);
  if (alreadyLogged && alreadyLogged.length > 0) return NextResponse.json({ received: true, duplicate: true });

  let reason = "";
  let reasonCode: string | null = null;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (pi) {
    const intent = await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] }).catch(() => null);
    reason = intent?.last_payment_error?.message || "";
    const ch = intent?.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
    reasonCode = ch?.failure_code || intent?.last_payment_error?.code || null;
  }

  const amount = ((session.amount_total || 0) / 100).toFixed(2);
  await logSystemHealthIssue({
    companyId,
    residentId: residentId || null,
    issueType: "rv_bank_payment_returned",
    source: "stripe_webhook",
    message: `${resident?.full_name || "A resident"}'s bank (ACH) payment of $${amount} was returned by the bank${reason ? ` (${reason})` : ""}. ${invoiceIds.length === 1 ? "The invoice is" : "The invoices are"} back to Pending (owed again). ${feeInvoice ? `A $${returnFee.total.toFixed(2)} returned bank payment fee (${returnFee.description}${returnFee.melyosShare > 0 ? `; when paid, $${returnFee.melyosShare.toFixed(2)} goes to MelyOS and $${returnFee.companyShare.toFixed(2)} to the park` : "; the fee is the park's — MelyOS bills the park its own charge per returned payment"}) was added to the ${feeInvoice.invoice_month || ""} invoice.` : `No invoice was open to add the $${returnFee.total.toFixed(2)} returned bank payment fee to — add it by hand if it applies.`} Contact the resident to pay again. Stripe session ${session.id}.`,
  });
  // Oct 28 (per Mely): email the resident — once (the issue above makes a redelivery stop at
  // alreadyLogged; the email also has its own per-session marker). One-time payment: autopay untouched.
  if (residentId) {
    const { data: openNow } = await supabase.from("resident_invoices").select("invoice_month, status").in("id", invoiceIds).eq("resident_id", residentId);
    const owed = (openNow || []).filter((i) => i.status === "Pending");
    await sendBankPaymentReturnedEmail({
      paymentRef: session.id,
      residentId,
      companyId,
      amount: (session.amount_total || 0) / 100,
      invoiceLabels: owed.map((i) => i.invoice_month || "an invoice"),
      invoicesOwedAgain: owed.length > 0,
      returnedByBank: true,
      reasonCode,
      reasonMessage: reason || null,
      feeAdded: !!feeInvoice,
      feeAmount: returnFee.total,
      feeBankPart: returnFee.serviceCharge !== null ? returnFee.bankFee : undefined,
      feeServicePart: returnFee.serviceCharge ?? undefined,
      feeExplanation: returnFee.serviceCharge === null ? returnFee.description : undefined,
      autopayTurnedOff: false,
      isAutopay: false,
    });
  }
  return NextResponse.json({ received: true });
}

// Oct 28 (review): a LOST dispute on an RV resident's bank (ACH) payment — the bank took the money
// back, so the invoices it paid are owed again: Paid → Pending, and System Health tells the office.
// Only invoices still Paid change, so a second event (created as lost, then closed) does nothing.
// Oct 29 (live-money audit M2): card disputes and autopay payments too (reopenRvInvoicesForReturn).
async function reopenRvInvoicesForLostBankDispute(session: Stripe.Checkout.Session, dispute: Stripe.Dispute, companyId: string) {
  const card = session.metadata?.payment_method !== "ach";
  await reopenRvInvoicesForReturn({
    meta: session.metadata || {}, companyId, issueType: card ? "rv_card_dispute_lost" : "rv_bank_dispute_lost",
    why: `A resident's ${card ? "card" : "bank (ACH)"} payment of $${(Number(dispute.amount || 0) / 100).toFixed(2)} was disputed with their bank and LOST (reason: ${dispute.reason || "not given"}). The money was taken back`,
    ref: `Stripe dispute ${dispute.id}, session ${session.id}`,
  });
}
async function reopenRvInvoicesForLostDisputeMeta(meta: Stripe.Metadata, dispute: Stripe.Dispute, companyId: string) {
  const card = meta.payment_method !== "ach";
  await reopenRvInvoicesForReturn({
    meta, companyId, issueType: card ? "rv_card_dispute_lost" : "rv_bank_dispute_lost",
    why: `A resident's ${card ? "card" : "bank"} AUTOPAY payment of $${(Number(dispute.amount || 0) / 100).toFixed(2)} was disputed with their bank and LOST (reason: ${dispute.reason || "not given"}). The money was taken back`,
    ref: `Stripe dispute ${dispute.id}`,
  });
}
// RV autopay charges (card or bank) carry their invoices in the charge metadata.
function isRvAutopayCharge(charge: Stripe.Charge): boolean {
  const m = charge.metadata || {};
  return (m.type === RV_CARD_AUTOPAY_TYPE || m.type === RV_AUTOPAY_PI_TYPE) && !!m.resident_id && !!m.invoice_ids;
}

// The money of an RV invoice payment went back to the payer (lost dispute, full refund in Stripe):
// the invoices it paid are owed again (Paid → Pending, only rows still Paid → a repeat changes
// nothing). That payment's own Sales Tax / fee lines are removed from the first invoice (they belong
// to the payment, not to what is owed), totals recomputed, System Health told. Returns how many
// invoices were reopened. A failed write throws (the webhook answers 500 → Stripe retries).
async function reopenRvInvoicesForReturn(p: { meta: Stripe.Metadata; companyId: string; issueType: string; why: string; ref: string }): Promise<number> {
  const invoiceIds = String(p.meta.invoice_ids || "").split(",").filter(Boolean);
  if (invoiceIds.length === 0) return 0;
  const { data: reopened, error } = await supabase
    .from("resident_invoices")
    .update({ status: "Pending" })
    .in("id", invoiceIds)
    .eq("status", "Paid")
    .select("id, invoice_month");
  if (error) throw new Error(`could not reopen invoices: ${error.message}`);
  if (!reopened || reopened.length === 0) return 0;

  // Review B1: an invoice reopened because the bank took the money back must never be charged again
  // automatically — the resident's autopay is turned OFF, and each invoice is marked so autopay
  // (card and bank) skips it even if autopay is turned back on.
  for (const r of reopened) await markDisputeReopened(r.id);
  let autopayNote = "";
  if (p.meta.resident_id) {
    const { data: off, error: offErr } = await supabase.from("resident_accounts").update({ autopay_enabled: false }).eq("id", p.meta.resident_id).eq("autopay_enabled", true).select("id, full_name");
    if (offErr) autopayNote = ` Autopay could NOT be turned off (${offErr.message}) — turn it off by hand.`;
    else if ((off || []).length) {
      autopayNote = " Their autopay was turned OFF so the reopened invoice is not charged again automatically.";
      await supabase.from("resident_update_notifications").insert({ company_id: p.companyId, resident_id: p.meta.resident_id, resident_name: off![0].full_name || null, update_type: "autopay_disabled",
        message: `Autopay was turned off for ${off![0].full_name || "a resident"} after a lost dispute.` }).then(() => null, () => null);
    }
  }

  const primaryId = invoiceIds[0];
  if (reopened.some((r) => r.id === primaryId)) {
    const wanted: { type: string; amount: number }[] = [];
    const tax = Number(p.meta.tax_charged || 0);
    const fee = Number(p.meta.processing_fee_charged || 0);
    if (tax > 0) wanted.push({ type: "Sales Tax", amount: tax });
    if (fee > 0) wanted.push({ type: p.meta.payment_method === "ach" ? "Bank Transfer Fee" : "Card Processing Fee", amount: fee });
    if (wanted.length > 0) {
      const { data: lines } = await supabase
        .from("resident_invoice_items")
        .select("id, charge_type, amount")
        .eq("invoice_id", primaryId)
        .in("charge_type", wanted.map((w) => w.type));
      const toDelete: string[] = [];
      for (const w of wanted) {
        const hit = (lines || []).find((l) => l.charge_type === w.type && !toDelete.includes(l.id) && Math.abs(Number(l.amount || 0) - w.amount) < 0.01);
        if (hit) toDelete.push(hit.id);
      }
      if (toDelete.length > 0) await supabase.from("resident_invoice_items").delete().in("id", toDelete);
    }
  }
  for (const r of reopened) {
    const { data: items } = await supabase.from("resident_invoice_items").select("amount").eq("invoice_id", r.id);
    if (items && items.length > 0) {
      const total = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      await supabase.from("resident_invoices").update({ total_amount: Math.round(total * 100) / 100 }).eq("id", r.id);
    }
  }

  await logSystemHealthIssue({
    companyId: p.companyId,
    residentId: p.meta.resident_id || null,
    issueType: p.issueType,
    source: "stripe_webhook",
    message: `${p.why}, so ${reopened.map((r) => r.invoice_month).filter(Boolean).join(", ") || "the invoice(s)"} ${reopened.length === 1 ? "is" : "are"} back to Pending (owed again).${autopayNote} Contact the resident; if they no longer owe it, write it off or add a credit. ${p.ref}.`,
  });
  return reopened.length;
}

// Oct 29 (live-money audit M2): an RV payment was FULLY refunded from the Stripe dashboard (refunds
// made from MelyOS Daily Close update the books themselves and never reach here). The record it paid
// is reopened / marked refunded, the "owed to park" ledger is corrected for unsplit payments, and the
// office is told once per charge.
async function handleRvFullRefundOutsideMelyos(charge: Stripe.Charge, pi: string, s: Stripe.Checkout.Session | null) {
  const meta: Stripe.Metadata = s?.metadata && Object.keys(s.metadata).length ? s.metadata : charge.metadata || {};
  if (meta.type === "marina_invoice" || meta.type === "marina_invoices" || meta.type === "marina_autopay") return; // handled above
  const companyId = await resolveCompanyIdFromMetadata(meta).catch(() => null);
  if (!companyId) return;
  const amount = (Number(charge.amount_refunded || charge.amount || 0) / 100).toFixed(2);
  const who = charge.billing_details?.name || charge.billing_details?.email || s?.customer_details?.name || "a customer";
  const ref = `Stripe charge ${charge.id}`;
  let what = "";

  if ((s && isRvInvoiceSession(s)) || (!s && isRvAutopayCharge(charge))) {
    // Review B1: NOT reopened automatically — a reopened invoice would be charged again by autopay the
    // next morning. The office decides (owed again → set it back to Pending; not owed → add a credit).
    what = `The invoice(s) it paid (${String(meta.invoice_ids || "").split(",").filter(Boolean).join(", ")}) were left Paid — if the resident still owes this money, set the invoice back to Pending by hand (check their autopay first); if not, add a "Refund" credit line.`;
  } else if (s && (s.metadata?.productId || s.metadata?.type === "propane_fillup")) {
    const { data: rows, error } = await supabase.from("propane_orders").update({ status: "refunded" }).eq("stripe_session_id", s.id).neq("status", "refunded").select("id");
    // Review M5: a CHECK constraint that doesn't allow "refunded" (sec_money.sql not run) is told, not retried.
    if (error && (error.code === "23514" || /check constraint/i.test(error.message || ""))) what = `The propane order could NOT be marked refunded (the database doesn't allow that status yet — run sec_money.sql), so its QR code may still work. Void it by hand.`;
    else if (error) throw new Error(`could not mark the propane order refunded: ${error.message}`);
    else what = (rows || []).length ? "The propane order was marked refunded — its QR code no longer works." : "";
  } else {
    const kind = meta.type === "application_fee" ? "application fee" : meta.type === "rent_to_own_deposit" ? "Rent-to-Own deposit"
      : meta.type === "manual_reservation" ? "reservation" : meta.type === "occupant_background_check" ? "occupant background check" : "online";
    what = `This ${kind} payment is NOT changed automatically — update it by hand (e.g. mark the fee/deposit unpaid, cancel the reservation).`;
  }

  // Unsplit payment (park_payout_ledger): the park is owed nothing for it now.
  let ledgerWhat = "";
  const owed = await parkOwedForPayment(pi);
  if (owed !== null && owed > 0) {
    const r = await reduceParkOwedForRefund(pi, owed, "Refunded in the Stripe dashboard", `refund:${charge.id}`);
    if (r.status === "reduced") ledgerWhat = ` The park's share was taken off "owed to the park" (MelyOS still held it).`;
    if (r.status === "settled" && r.owed > 0) {
      const source = `Refund ${charge.id} payout`;
      const { data: had } = await supabase.from("melyos_billing_charges").select("id").eq("company_id", companyId).eq("source", source).limit(1);
      if (!had?.length) {
        await recordMelyOSBillingCharge({ companyId, chargeType: "Refund not recovered from payout", source, markup: 0, amount: r.owed,
          description: `${who}'s payment was refunded in full ($${amount}). The park's share ($${r.owed.toFixed(2)}) had already been paid out to the park by hand, so it is owed back to MelyOS.` });
      }
      const { data: billedNow } = await supabase.from("melyos_billing_charges").select("id").eq("company_id", companyId).eq("source", source).limit(1);
      if (!billedNow?.length) throw new Error("could not bill the park's refunded share"); // retried
      await confirmSettledRefundBilled(pi, r.owed, "Refunded in the Stripe dashboard", `refund:${charge.id}`);
      ledgerWhat = ` The park's share ($${r.owed.toFixed(2)}) had already been paid out to the park, so it was added to MelyOS Fees Owed.`;
    }
  }

  if (what || ledgerWhat) {
    const { data: logged } = await supabase.from("system_health_issues").select("id").eq("company_id", companyId).eq("issue_type", "rv_payment_refunded").like("message", `%${ref}%`).limit(1);
    if (!logged?.length) {
      await logSystemHealthIssue({ companyId, residentId: meta.resident_id || null, issueType: "rv_payment_refunded", source: "stripe_webhook",
        message: `${who}'s payment of $${amount} was REFUNDED in full in the Stripe dashboard (not from MelyOS). ${what}${ledgerWhat} ${ref}.`.replace(/\s+/g, " ").trim() });
    }
  }
}

// Oct 28 (review): the application-fee and Rent-to-Own deposit handlers moved to
// src/lib/lotPaymentHandlers.ts so the daily lot-payment reconcile cron can finish a payment the
// webhook couldn't (same code, same idempotency).

const PROPANE_PRODUCT_LABELS: Record<string, string> = {
  "20lb": "20 LB Tank",
  "30lb": "30 LB Tank",
  "40lb": "40 LB Tank",
  forklift: "Forklift",
  motorhome: "Motor Home 40LB Tank",
};

// ⚠️ propane_orders holds real Stripe transactions and each row's qr_token
// is the customer's ONLY way to redeem their tank(s) — there is no
// recovery path if a row is deleted. NEVER run an unconditional
// `DELETE FROM propane_orders` (e.g. during a "clear test data" cleanup)
// without a WHERE clause protecting real/recent purchases — this already
// happened once and wiped 2 real customer orders along with test data.
// If bulk-clearing test data, filter by a specific test email/date range,
// or move test rows to `status = 'test'` and filter on that instead.
async function handlePropanePaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const { productId, quantity, lotId, park, residentLot, subtotalCents, taxCents, feeCents } =
    session.metadata || {};

  try {
    const qrToken = crypto.randomBytes(16).toString("hex");
    const customerEmail = session.customer_details?.email || null;

    // Oct 22 (security/reliability): insert only if this payment isn't saved yet. The map app's
    // webhook can receive the same Stripe event; overwriting would change the QR code the
    // customer already got by email, so the second one now leaves the order alone.
    const { data: inserted, error } = await supabase.from("propane_orders").upsert(
      {
        park_id: park || "aloha",
        lot_id: lotId || null,
        product_id: productId,
        product_label: PROPANE_PRODUCT_LABELS[productId as string] || productId,
        quantity: parseFloat(quantity as string),
        unit: productId === "motorhome" ? "gallon" : "tank",
        amount_total: (session.amount_total || 0) / 100,
        subtotal_amount: subtotalCents != null ? Number(subtotalCents) / 100 : null,
        tax_amount: taxCents != null ? Number(taxCents) / 100 : null,
        fee_amount: feeCents != null ? Number(feeCents) / 100 : null,
        currency: session.currency || "usd",
        customer_email: customerEmail,
        stripe_session_id: session.id,
        stripe_payment_intent: (session.payment_intent as string) || null,
        status: "paid",
        paid_at: new Date().toISOString(),
        qr_token: qrToken,
        redeemed: false,
        resident_lot_name: residentLot || null,
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true }
    ).select("id");

    if (error) {
      // Oct 29 (live-money audit M3): the customer paid — never acknowledge a lost order; Stripe retries.
      console.error("Error saving propane order:", error.message);
      return "retry";
    }
    if (!inserted || inserted.length === 0) return; // already saved (and emailed) once

    const { data: company } = await supabase
      .from("companies")
      .select("id, company_name")
      .eq("park_id", park || "aloha")
      .single();

    if (company) {
      await supabase.from("resident_update_notifications").insert({
        company_id: company.id,
        resident_name: session.customer_details?.name || customerEmail || null,
        update_type: "propane_payment",
        message: (() => {
          const q = parseFloat(quantity as string);
          const lbsPer = parseInt(String(productId), 10);
          const what = productId === "motorhome"
            ? `${q} gal Motor Home fill-up`
            : `${q} × ${PROPANE_PRODUCT_LABELS[productId as string] || productId}${Number.isFinite(lbsPer) ? ` (${lbsPer * q} lbs)` : ""}`;
          return `Bought ${what} — paid $${((session.amount_total || 0) / 100).toFixed(2)}`;
        })(),
      });
    }

    if (customerEmail && process.env.RESEND_API_KEY) {
      try {
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrToken)}`;
        const label = PROPANE_PRODUCT_LABELS[productId as string] || productId;
        const amount = ((session.amount_total || 0) / 100).toFixed(2);

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${String(company?.company_name || "Aloha RV Park").replace(/[<>,"]/g, "")} <noreply@aloharvparkfl.com>`, // Oct 29 (Low): the park's own name
            to: customerEmail,
            subject: "Your Propane Pickup QR Code",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto;">
                <h2>⛽ Payment Confirmed</h2>
                <p>${quantity} ${productId === "motorhome" ? "gallons" : "×"} ${label} — $${amount}</p>
                <img src="${qrImageUrl}" alt="Propane pickup QR code" style="display:block;margin:16px 0;" />
                <p style="font-size:13px;color:#555;">${
                  productId === "motorhome"
                    ? "Show this code to staff for your fill-up. It can only be used once."
                    : `Show this code to staff each time you pick up a tank — this code works once per tank purchased (${quantity} total, multiple visits OK).`
                } No refunds — unpicked-up tanks are not refundable.</p>
              </div>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("Failed to send propane QR email:", emailErr);
      }
    }
  } catch (err) {
    console.error("Error saving propane order:", err);
    return "retry"; // Oct 29 (M3): the insert is idempotent (stripe_session_id), so a retry is safe
  }
}

// Oct 29 (live-money audit H2): the motor-home fill-up the staff rang up (admin app
// create-fillup-checkout) and the customer paid by scanning. Already "picked up" (the fill-up
// happened before paying). Saved once per Stripe session — the staff screen's polling
// (fillup-checkout-status) uses the same upsert, so whichever comes first saves it, the other
// changes nothing (and only the one that saved it notifies the office).
async function handlePropaneFillupPaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const m = session.metadata || {};
  const companyId = m.companyId || m.company_id || null;
  if (!companyId) return;
  const { data: company, error: coErr } = await supabase.from("companies").select("id, park_id").eq("id", companyId).maybeSingle();
  if (coErr) return "retry"; // Review (Low): a read failure is retried, not dropped
  if (!company) return;
  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase.from("propane_orders").upsert({
    park_id: m.parkId || company.park_id || null,
    product_id: "motorhome",
    product_label: "Motor Home 40LB Tank",
    quantity: parseFloat(m.gallons || "0"),
    unit: "gallon",
    amount_total: (session.amount_total || 0) / 100,
    subtotal_amount: m.subtotalCents != null ? Number(m.subtotalCents) / 100 : null,
    tax_amount: m.taxCents != null ? Number(m.taxCents) / 100 : null,
    fee_amount: m.feeCents != null ? Number(m.feeCents) / 100 : null,
    currency: session.currency || "usd",
    customer_email: session.customer_details?.email || null,
    stripe_session_id: session.id,
    stripe_payment_intent: (session.payment_intent as string) || null,
    status: "paid",
    paid_at: now,
    qr_token: crypto.randomBytes(16).toString("hex"),
    redeemed: true,
    redeemed_at: now,
    redeemed_by: m.staffName || null,
  }, { onConflict: "stripe_session_id", ignoreDuplicates: true }).select("id");
  if (error) {
    console.error("Error saving propane fill-up:", error.message);
    return "retry";
  }
  if (!inserted || inserted.length === 0) return; // already saved
  await supabase.from("resident_update_notifications").insert({
    company_id: companyId,
    resident_name: session.customer_details?.name || session.customer_details?.email || null,
    update_type: "propane_payment",
    message: `Bought ${m.gallons || ""} gal Motor Home fill-up — paid $${((session.amount_total || 0) / 100).toFixed(2)}`,
  }).then(() => null, () => null);
}

// Oct 29 (live-money audit M5): handleOccupantBackgroundCheckPaid moved to src/lib/occupantBackgroundCheck.ts.

async function handleManualReservationPaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const lotOrderId = session.metadata?.lot_order_id;
  const amountPaid = ((session.amount_total || 0) / 100).toFixed(2);
  // Oct 29 (live-money audit M3): money arrived but the reservation can't be matched → the office is
  // told (it never just disappears into the logs).
  const tellOffice = async (issueType: string, message: string) => {
    const cid = session.metadata?.company_id || (await resolveCompanyIdFromMetadata(session.metadata).catch(() => null));
    if (!cid) { console.error("manual reservation webhook:", message); return; }
    const { data: had } = await supabase.from("system_health_issues").select("id").eq("company_id", cid).eq("issue_type", issueType).like("message", `%${session.id}%`).limit(1);
    if (had?.length) return;
    await logSystemHealthIssue({ companyId: cid, issueType, source: "stripe_webhook", message });
  };
  if (!lotOrderId) {
    await tellOffice("reservation_payment_review", `A reservation payment of $${amountPaid} arrived without its reservation reference, so it was not applied to any reservation. Find it in Stripe and apply it by hand, or refund it. Stripe session ${session.id}.`);
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  // Oct 20 (security review): only mark the order paid if what was
  // actually paid covers the saved reservation amount.
  {
    const { data: order, error: orderErr } = await supabase.from("lot_orders").select("amount_total, status, lot_id, park_id, arrival_date, departure_date, customer_name, stripe_session_id, stripe_payment_intent").eq("id", lotOrderId).maybeSingle();
    if (orderErr) return "retry";
    const dueCents = Math.round(Number((order as any)?.amount_total || 0) * 100);
    if (!order) {
      await tellOffice("reservation_payment_review", `A reservation payment of $${amountPaid} arrived for a reservation that no longer exists (order ${lotOrderId}). Nothing was applied — refund it or book it by hand. Stripe session ${session.id}.`);
      return;
    }
    if ((order as any).status === "paid") {
      // Oct 29 (live-money audit M4): a retried delivery of the SAME payment changes nothing; a
      // SECOND payment for an already-paid reservation (two links / two tabs) is a duplicate.
      const samePayment = (order as any).stripe_session_id === session.id
        || (!!(order as any).stripe_payment_intent && (order as any).stripe_payment_intent === (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id));
      if (!samePayment) {
        await tellOffice("rv_possible_duplicate_payment", `${(order as any).customer_name || "A guest"} paid $${amountPaid} AGAIN for a reservation on Lot ${(order as any).lot_id} that was already paid (${(order as any).arrival_date || ""} to ${(order as any).departure_date || ""}). This is a duplicate payment — refund it from Shifts & Daily Close. Stripe session ${session.id}.`);
      }
      return;
    }
    if (Number(session.amount_total || 0) + 1 < dueCents) {
      await tellOffice("reservation_payment_review", `${(order as any).customer_name || "A guest"} paid $${amountPaid} for a reservation on Lot ${(order as any).lot_id} that costs $${(dueCents / 100).toFixed(2)} (the amount changed after the payment link was made). The reservation was NOT marked paid — collect the difference and mark it by hand, or refund. Stripe session ${session.id}.`);
      return;
    }
    // Oct 28 (per Mely — two people paying for the same lot): the reservation row holds the dates
    // (no_overlapping_reservations). If it was cancelled/expired while the guest was paying and the
    // dates were then taken by someone else, the lot is NOT given to this payer. This checkout
    // captures immediately (it is not a lot-application checkout), so the money is NOT refunded
    // automatically — the office is told to offer another lot / the waitlist, or refund by hand.
    const companyId = session.metadata?.company_id || null;
    const { data: resv } = companyId
      ? await supabase.from("reservations").select("id, reservation_status, space_id").eq("lot_order_id", lotOrderId).eq("company_id", companyId).maybeSingle()
      : { data: null as any };
    const released = (order as any).status !== "pending" || resv?.reservation_status === "cancelled";
    if (released && companyId && (order as any).arrival_date && (order as any).departure_date) {
      const a = (order as any).arrival_date, d = (order as any).departure_date;
      const [{ data: paidOrders }, { data: liveResv }] = await Promise.all([
        supabase.from("lot_orders").select("id").eq("lot_id", (order as any).lot_id).eq("park_id", (order as any).park_id || "aloha").eq("status", "paid").neq("id", lotOrderId).lt("arrival_date", d).gt("departure_date", a).limit(1),
        resv?.space_id
          ? supabase.from("reservations").select("id").eq("company_id", companyId).eq("space_id", resv.space_id).neq("reservation_status", "cancelled").neq("lot_order_id", lotOrderId).lt("arrival_date", d).gt("departure_date", a).limit(1)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      let taken = (paidOrders || []).length > 0 || (liveResv || []).length > 0;
      // Oct 28 (review): the dates are still free → bring the reservation back (the exclusion
      // constraint no_overlapping_reservations still catches a same-instant overlap → conflict path),
      // and tell the office — never leave it paid-but-cancelled silently.
      if (!taken && resv?.id) {
        let reactivated = resv.reservation_status !== "cancelled";
        if (!reactivated) {
          const { error: reErr } = await supabase.from("reservations").update({ reservation_status: "confirmed" }).eq("id", resv.id).eq("company_id", companyId);
          if (reErr?.code === "23P01") taken = true;
          else if (reErr) console.error("Manual reservation webhook: could not reactivate reservation", resv.id, reErr.message);
          else reactivated = true;
        }
        if (!taken) {
          // (Lot status is left alone: the arrival-day crons turn it orange/red on the right day — Aug 14 rule.)
          await logSystemHealthIssue({
            companyId,
            issueType: "reservation_reactivated",
            source: "stripe_webhook",
            message: reactivated
              ? `${(order as any).customer_name || "A guest"} paid $${((session.amount_total || 0) / 100).toFixed(2)} for a reservation on Lot ${(order as any).lot_id} (${a} to ${d}) after it had been ${(order as any).status !== "pending" ? (order as any).status : "cancelled"}. The dates were still free, so the reservation was REACTIVATED and marked paid. Check it in Reservations. Stripe session ${session.id}.`
              : `${(order as any).customer_name || "A guest"} paid $${((session.amount_total || 0) / 100).toFixed(2)} for a cancelled reservation on Lot ${(order as any).lot_id} (${a} to ${d}). The payment was recorded, but the reservation could NOT be reactivated automatically — reactivate it by hand or contact the guest. Stripe session ${session.id}.`,
          });
        }
      }
      if (taken) {
        if ((order as any).stripe_session_id !== session.id) {
          // Record which payment arrived (status unchanged — it must not block the dates), once.
          await supabase.from("lot_orders").update({ stripe_session_id: session.id, stripe_payment_intent: paymentIntentId }).eq("id", lotOrderId);
          await logSystemHealthIssue({
            companyId,
            issueType: "lot_checkout_conflict",
            source: "stripe_webhook",
            message: `${(order as any).customer_name || "A guest"} PAID $${((session.amount_total || 0) / 100).toFixed(2)} for a reservation on Lot ${(order as any).lot_id} (${a} to ${d}) that had been ${(order as any).status !== "pending" ? (order as any).status : "cancelled"}, and those dates are now taken by another booking. The lot was NOT assigned and the payment was NOT refunded automatically — contact them to offer another lot or the waitlist, or refund it from Daily Close. Stripe session ${session.id}.`,
          });
          await supabase.from("resident_update_notifications").insert({
            company_id: companyId,
            resident_name: (order as any).customer_name || null,
            update_type: "double_booking_alert",
            message: `⚠️ ${(order as any).customer_name || "A guest"} paid for a cancelled reservation on Lot ${(order as any).lot_id} (${a} to ${d}), but those dates are already booked. Contact them to offer another lot (payment collected, not refunded).`,
          });
        }
        return;
      }
    }
  }

  const { data: updatedOrder, error } = await supabase
    .from("lot_orders")
    .update({
      status: "paid",
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
    })
    .eq("id", lotOrderId)
    .select("customer_name, lot_id, arrival_date, departure_date, park_id")
    .single();

  if (error) {
    console.log("Error updating lot_orders after manual reservation payment:", error.message);
    return "retry"; // Oct 29 (M3): Stripe sends it again (the paid check above makes it idempotent)
  }

  console.log(`Manual reservation payment confirmed for lot_order ${lotOrderId}.`);

  // Notify the admin — they created this reservation as "pending" and have
  // no other way of knowing exactly when the guest actually completes payment.
  if (updatedOrder?.lot_id) {
    // Oct 28: lot names repeat across parks — use this payment's own company when it is known.
    let lotQuery = supabase.from("rv_lots").select("company_id").eq("lot_name", updatedOrder.lot_id);
    if (session.metadata?.company_id) lotQuery = lotQuery.eq("company_id", session.metadata.company_id);
    const { data: lot } = await lotQuery.limit(1).maybeSingle();

    if (lot?.company_id) {
      await supabase.from("resident_update_notifications").insert({
        company_id: lot.company_id,
        resident_name: updatedOrder.customer_name,
        update_type: "reservation_paid",
        message: `${updatedOrder.customer_name}'s reservation payment for lot ${updatedOrder.lot_id} was confirmed.`,
      });

      // Safety net against a race condition: availability is only checked
      // once, when this checkout session was first created — if another
      // booking for overlapping dates on the same lot completed payment in
      // the meantime, both would now show as "paid". Re-check here and
      // flag it instead of letting a double-booking go unnoticed.
      if (updatedOrder.arrival_date && updatedOrder.departure_date) {
        const { data: otherOrders } = await supabase
          .from("lot_orders")
          .select("id, arrival_date, departure_date")
          .eq("lot_id", updatedOrder.lot_id)
          .eq("park_id", (updatedOrder as any).park_id || "aloha") // Oct 28: this park's lot only
          .eq("status", "paid")
          .neq("id", lotOrderId);

        const newArrival = new Date(updatedOrder.arrival_date + "T00:00:00");
        const newDeparture = new Date(updatedOrder.departure_date + "T00:00:00");
        const conflicting = (otherOrders || []).filter((o: any) => {
          if (!o.arrival_date || !o.departure_date) return false;
          const oStart = new Date(o.arrival_date + "T00:00:00");
          const oEnd = new Date(o.departure_date + "T00:00:00");
          return newArrival < oEnd && newDeparture > oStart;
        });

        if (conflicting.length > 0) {
          console.error(
            `DOUBLE-BOOKING DETECTED on lot ${updatedOrder.lot_id}: lot_order ${lotOrderId} overlaps with`,
            conflicting.map((o: any) => o.id)
          );
          await supabase.from("lot_orders").update({ has_conflict: true }).eq("id", lotOrderId);
          await supabase
            .from("lot_orders")
            .update({ has_conflict: true })
            .in("id", conflicting.map((o: any) => o.id));
          await supabase.from("resident_update_notifications").insert({
            company_id: lot.company_id,
            resident_name: null,
            update_type: "double_booking_alert",
            message: `⚠️ Possible double-booking on Lot ${updatedOrder.lot_id}: two paid reservations overlap for ${updatedOrder.arrival_date} to ${updatedOrder.departure_date}. Review and contact both customers.`,
          });
        }
      }
    }
  }
}

async function handleCrewBackgroundCheckPaid(session: Stripe.Checkout.Session) {
  const applicantId = session.metadata?.applicant_id;
  const companyId = session.metadata?.company_id;
  if (!applicantId || !companyId) return;
  const { data: a } = await supabase.from("crew_applicants").select("*").eq("id", applicantId).eq("company_id", companyId).maybeSingle();
  if (!a || a.bgc_status !== "not_started") return; // already handled (Stripe retries)
  await supabase.from("crew_applicants").update({ bgc_status: "paid", bgc_paid_at: new Date().toISOString(), bgc_stripe_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", a.id);
  const { data: settings } = await supabase.from("park_settings").select("checkr_work_location_state, checkr_default_package_slug").eq("company_id", companyId).maybeSingle();
  const state = settings?.checkr_work_location_state || "FL";
  const pkg = settings?.checkr_default_package_slug || "basic_plus_criminal";
  try {
    const { candidateId, invitationId, invitationUrl } = await createCheckrInvitation({ applicationId: "crew", personKey: a.id, email: a.email, fullName: a.full_name, state, packageSlug: pkg });
    await supabase.from("crew_applicants").update({ bgc_status: "invited", checkr_candidate_id: candidateId, checkr_invitation_id: invitationId, checkr_invitation_url: invitationUrl || null, updated_at: new Date().toISOString() }).eq("id", a.id);
  } catch (err: any) {
    console.log(`Crew applicant ${a.id}: could not create Checkr invitation:`, err?.message);
    await logSystemHealthIssue({ companyId, issueType: "crew_checkr_invitation_failed", source: "checkr", message: `Crew applicant ${a.full_name} paid but the Checkr invitation failed: ${err?.message}` });
  }
}

// Oct 24 (security run): when a connected account's status changes in Stripe (payouts paused,
// details missing, account disabled), keep park_settings in step right away, so checkout never
// sends money to an account that can't take it, and the office sees why in System Health.
async function handleConnectEvent(event: Stripe.Event) {
  if (event.type === "account.updated") {
    const acct = event.data.object as Stripe.Account;
    const onboarded = !!acct.details_submitted && !!acct.charges_enabled;
    const { data: rows } = await supabase.from("park_settings").select("company_id, stripe_connect_onboarded").eq("stripe_connect_account_id", acct.id);
    for (const r of rows || []) {
      if (r.stripe_connect_onboarded === onboarded) continue;
      await supabase.from("park_settings").update({ stripe_connect_onboarded: onboarded }).eq("company_id", r.company_id).eq("stripe_connect_account_id", acct.id);
      if (!onboarded) {
        await logSystemHealthIssue({
          companyId: r.company_id,
          issueType: "stripe_account_restricted",
          source: "stripe_webhook",
          message: `Stripe paused online payments for this company's payout account (${acct.requirements?.disabled_reason || "details needed"}). Online payments are off until it's fixed in Settings → Stripe.`,
        });
      }
    }
  }
  return NextResponse.json({ received: true });
}
