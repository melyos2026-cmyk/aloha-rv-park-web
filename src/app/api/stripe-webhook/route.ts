import { cardHoldPlaced } from "@/lib/marina/payments";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { alertCheckrFailure } from "@/lib/alertCheckrFailure";
import { createCheckrInvitation, computeAggregateStatus, CheckrResultEntry } from "@/lib/checkr";
import { recordMelyOSBillingCharge } from "@/lib/billingCharges";
import { checkAndCompleteRentToOwnPlan } from "@/lib/rentToOwnCompletion";
import { generateApplicationFeeReceiptPdf } from "@/lib/generate-application-fee-receipt";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
import { recordMarinaOnlinePayment, settleMarinaAchPayment, failMarinaAchPayment, returnMarinaOnlinePayment, returnMarinaPaymentRef } from "@/lib/marina/payments";
import { autopayBankFailed } from "@/lib/marina/autopay";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import crypto from "crypto";

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

  if (event.type === "checkout.session.completed") {
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
        const intent = await stripe.paymentIntents.retrieve(pi).catch(() => null);
        if (intent?.status === "requires_capture") await cardHoldPlaced(session.metadata.company_id, session.metadata.invoice_id, pi, session.id, intent.amount / 100, Number(session.metadata.processing_fee_charged || 0) > 0);
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
      });
    }

    if (session.metadata?.type === "application_fee") {
      await handleApplicationFeePaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "manual_reservation") {
      await handleManualReservationPaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "rent_to_own_deposit") {
      await handleRentToOwnDepositPaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "occupant_background_check") {
      await handleOccupantBackgroundCheckPaid(session);
      return NextResponse.json({ received: true });
    }

    // Oct 23 (per Mely — Careers & Crew): the applicant paid their own background check →
    // send the Checkr invitation (customId "crew::<applicantId>").
    if (session.metadata?.type === "crew_background_check") {
      await handleCrewBackgroundCheckPaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.productId) {
      await handlePropanePaid(session);
      return NextResponse.json({ received: true });
    }

    const residentId = session.metadata?.resident_id;
    const invoiceIdsRaw = session.metadata?.invoice_ids || "";
    const invoiceIds = invoiceIdsRaw.split(",").filter(Boolean);
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
        .select("invoice_id, description, amount")
        .in("invoice_id", invoiceIds);

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
      if (taxCharged > 0) {
        chargesPaid.push({ label: `Sales Tax (${taxRatePercent}%)`, amount: taxCharged });
      }
      if (processingFeeCharged > 0) {
        chargesPaid.push({ label: "Card Processing Fee", amount: processingFeeCharged });
      }

      // Aug 5 (per Mely — real gap she caught: the invoice record never
      // showed the fee/tax Stripe actually charged): attach these as real
      // line items on the FIRST invoice being paid (the common case is
      // exactly one), then recompute that invoice's total_amount to
      // match what was truly collected — same safe "always recompute
      // from all items" pattern used everywhere else in this codebase.
      const primaryInvoiceId = invoiceIds[0];
      // Oct 20 (security review): skip if this invoice is already Paid —
      // a repeated delivery must not insert the tax/fee lines twice.
      if (
        primaryInvoiceId &&
        !alreadyPaidIds.has(primaryInvoiceId) &&
        (processingFeeCharged > 0 || taxCharged > 0)
      ) {
        if (taxCharged > 0) {
          await supabase.from("resident_invoice_items").insert({
            invoice_id: primaryInvoiceId,
            charge_type: "Sales Tax",
            description: `Sales Tax (${taxRatePercent}%)`,
            amount: taxCharged,
          });
        }
        if (processingFeeCharged > 0) {
          await supabase.from("resident_invoice_items").insert({
            invoice_id: primaryInvoiceId,
            charge_type: "Card Processing Fee",
            description: "Card Processing Fee",
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

      const { error: invoiceUpdateError } = await supabase
        .from("resident_invoices")
        .update({ status: "Paid" })
        .in("id", invoiceIds);

      if (invoiceUpdateError) {
        console.log("Error updating resident_invoices:", invoiceUpdateError.message);
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

  // Oct 8 (per Mely — Shifts & Daily Close): a full refund voids the online payment in the daily close;
  // a partial refund cannot be split automatically, so it is flagged in System Health for review.
  // Requires the event "charge.refunded" to be enabled on this webhook endpoint in the Stripe dashboard.
  // Oct 24: bank (ACH) payments clear or fail days after checkout.
  if (event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if ((session.metadata?.type === "marina_invoice" || session.metadata?.type === "marina_invoices") && session.metadata.company_id) {
      if (event.type === "checkout.session.async_payment_succeeded") await settleMarinaAchPayment(session.metadata.company_id, `online:${session.id}`);
      else await failMarinaAchPayment(session.metadata.company_id, `online:${session.id}`, "the bank declined the transfer");
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
    // Oct 24 (per Mely): marina invoice payments refunded in Stripe.
    if (pi) {
      try {
        const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
        const s = sessions.data[0];
        // Oct 27: refunds made from MelyOS (Invoices → Refund) update the books themselves. Decided per
        // refund: only when EVERY refund on this charge came from MelyOS is there nothing to do here.
        const refundsOnCharge = await stripe.refunds.list({ charge: charge.id, limit: 100 }).then((x) => x.data, () => [] as Stripe.Refund[]);
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
      if (companyId) {
        const source = `Stripe dispute ${dispute.id}`;
        const { data: existing } = await supabase.from("melyos_billing_charges").select("id").eq("source", source).limit(1);
        if (!existing || existing.length === 0) {
          await recordMelyOSBillingCharge({
            companyId,
            chargeType: "Chargeback fee",
            source,
            description: `Card dispute (chargeback) by ${who} on a $${amount} payment. Stripe charges a $${disputeFee.toFixed(2)} fee for every dispute.`,
            amount: disputeFee,
            markup: 0,
          });
          await logSystemHealthIssue({
            companyId,
            issueType: "chargeback",
            source: "stripe_webhook",
            message: `${who} disputed a $${amount} card payment with their bank (reason: ${dispute.reason || "not given"}). A $${disputeFee} chargeback fee was added to MelyOS Fees Owed. Respond in Stripe before ${dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString("en-US") : "the deadline"} to try to win it.`,
          });
        }
      } else {
        console.error("charge.dispute.created: could not find the company for dispute", dispute.id);
      }
    } catch (err: any) {
      console.error("charge.dispute.created handling failed:", err?.message);
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
      // Oct 24 (per Mely): a lost dispute on a marina payment reopens the invoice(s).
      if (charge?.payment_intent) {
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
        const ss = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 }).catch(() => null);
        const s0 = ss?.data[0];
        if (s0 && (s0.metadata?.type === "marina_invoice" || s0.metadata?.type === "marina_invoices") && s0.metadata.company_id) {
          await returnMarinaOnlinePayment(s0.metadata.company_id, s0.id, `Lost card dispute ${dispute.id}`);
        }
        // Oct 26: autopay charges have no checkout session; the metadata is on the charge.
        if (!s0 && charge.metadata?.type === "marina_autopay" && charge.metadata.company_id) {
          await returnMarinaPaymentRef(charge.metadata.company_id, `autopay:${piId}`, `Lost card dispute ${dispute.id}`);
        }
      }
      const source = `Stripe lost dispute ${dispute.id}`;
      const { data: done } = await supabase.from("melyos_billing_charges").select("id").eq("source", source).limit(1);
      if (done && done.length) return NextResponse.json({ received: true });

      const who = charge.billing_details?.name || charge.billing_details?.email || "a customer";
      const totalCents = Number(dispute.amount || 0);
      const melyosCents = Math.min(Number(charge.application_fee_amount || 0), totalCents);
      const parkCents = Math.max(totalCents - melyosCents, 0);

      // 1) MelyOS's own part of the payment → owed by the park.
      if (melyosCents > 0) {
        await recordMelyOSBillingCharge({
          companyId,
          chargeType: "Lost chargeback (MelyOS fees)",
          source,
          description: `Lost card dispute by ${who} on a $${(totalCents / 100).toFixed(2)} payment. The bank kept the whole payment, including the fees MelyOS had kept from it (card processing fee and, if any, application / background check fees): $${(melyosCents / 100).toFixed(2)}.`,
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
            description: `The card dispute by ${who} was answered with evidence and lost. Stripe charges $15.00 to respond to a dispute and returns it only when the dispute is won.`,
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
        if (reversalNote) {
          // Couldn't take it back automatically → record it as owed instead.
          await recordMelyOSBillingCharge({
            companyId,
            chargeType: "Lost chargeback (park share)",
            source: `${source} (park share)`,
            description: `Lost card dispute by ${who}: the park's share of $${(parkCents / 100).toFixed(2)} could not be taken back from the payout automatically (${reversalNote}).`,
            amount: parkCents / 100,
            markup: 0,
          });
        }
      }

      await logSystemHealthIssue({
        companyId,
        issueType: "chargeback",
        source: "stripe_webhook",
        message: `The card dispute by ${who} on a $${(totalCents / 100).toFixed(2)} payment was LOST. ${parkCents > 0 ? (reversalNote ? `The park's share ($${(parkCents / 100).toFixed(2)}) was added to MelyOS Fees Owed.` : `The park's share ($${(parkCents / 100).toFixed(2)}) was taken back from the park's payout.`) : ""} ${melyosCents > 0 ? `MelyOS's fees on that payment ($${(melyosCents / 100).toFixed(2)}) were added to MelyOS Fees Owed.` : ""}`.trim(),
      });
    } catch (err: any) {
      console.error("charge.dispute.closed handling failed:", err?.message);
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
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
      else await autopayBankFailed(intent.metadata.company_id, intent.id, intent.last_payment_error?.message || "the payment failed");
      return NextResponse.json({ received: true });
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object as Stripe.PaymentIntent;
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

async function handleApplicationFeePaid(session: Stripe.Checkout.Session) {
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
  {
    const { data: existing } = await supabase
      .from("resident_applications")
      .select("application_fee_paid, application_fee_stripe_payment_intent_id, checkr_invitation_sent_at, company_id, full_name")
      .eq("id", applicationId)
      .maybeSingle();
    if (existing?.application_fee_paid) {
      const samePayment =
        !!paymentIntentId && existing.application_fee_stripe_payment_intent_id === paymentIntentId;
      console.warn(
        `stripe-webhook: application ${applicationId} already marked paid — skipping (${samePayment ? "duplicate delivery" : "different payment"}).`
      );
      if (!samePayment && existing.company_id) {
        await logSystemHealthIssue({
          companyId: existing.company_id,
          issueType: "refund_review",
          source: "stripe_webhook",
          message: `${existing.full_name || "An applicant"} paid the application fee online ($${((session.amount_total || 0) / 100).toFixed(2)}), but the application was already marked paid. Check for a double payment and refund if needed (Stripe ${paymentIntentId || session.id}).`,
        });
      }
      return;
    }
  }

  const { data: application, error } = await supabase
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
    .select(
      "id, full_name, email, application_fee_total, application_fee_primary, application_fee_per_additional, application_fee_additional_count, application_processing_fee, background_check_required, company_id, occupants, space_id, park_share_total"
    )
    .single();

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
  if (!error && application?.space_id) {
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
  if (!error && checkrFeeChargedViaConnect && checkrFeeDeductedAmount > 0 && application?.company_id) {
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
  if (!error && application?.company_id) {
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
    return;
  }

  // Aug 6 (per Mely): once the application fee (incl. background check)
  // is paid, hold the selected lot as "reserved" (yellow on the map) so
  // it doesn't look free to book/apply for while this application is
  // still pending admin's decision. Flips to occupied on approval, or
  // back to available on denial — same "reserved" convention already
  // used for confirmed reservations and pending move-outs.
  if (application?.space_id) {
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
  if (application?.email && process.env.RESEND_API_KEY) {
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
      if (process.env.RESEND_API_KEY) {
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
      if (process.env.RESEND_API_KEY) {
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
    if (process.env.RESEND_API_KEY) {
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
async function handlePropanePaid(session: Stripe.Checkout.Session) {
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
      console.error("Error saving propane order:", error.message);
      return;
    }
    if (!inserted || inserted.length === 0) return; // already saved (and emailed) once

    const { data: company } = await supabase
      .from("companies")
      .select("id")
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
            from: "Aloha RV Park <noreply@aloharvparkfl.com>",
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
  }
}

async function handleRentToOwnDepositPaid(session: Stripe.Checkout.Session) {
  const applicationId = session.metadata?.application_id;
  if (!applicationId) {
    console.log("Rent-to-own deposit webhook missing application_id metadata");
    return;
  }

  // Aug 25 (per Mely — reviewing the Rent-to-Own flow end to end): found
  // live — this .select() asked for "rent_to_own_deposit_amount", a
  // column that doesn't exist anywhere in the schema (the real column,
  // used everywhere else in the codebase, is "rent_to_own_deposit").
  // PostgREST rejects the entire update+select request when the select
  // list references an unknown column, so this silently NEVER marked a
  // card-paid Rent-to-Own deposit as paid — the resident's card was
  // really charged and Stripe really confirmed it, but
  // rent_to_own_deposit_paid stayed false forever and the admin was
  // never notified. Fixed to select real columns only.
  //
  // Sep 26 (per Mely — "esta todo conectado?"): this payment was
  // completely invisible in All Transactions/Payments & Taxes — there
  // was no timestamp column at all recording WHEN it was paid, so
  // nothing could ever include it in a report. Added
  // rent_to_own_deposit_paid_at and set it here, same as every other
  // real payment date in this system.
  const { data: application, error } = await supabase
    .from("resident_applications")
    .update({
      rent_to_own_deposit_paid: true,
      rent_to_own_deposit_method: "Stripe",
      rent_to_own_deposit_paid_at: new Date().toISOString(),
    })
    .eq("id", applicationId)
    .select("full_name, company_id, rent_to_own_deposit")
    .single();

  if (error) {
    console.log("Error marking rent-to-own deposit paid:", error.message);
  } else {
    console.log(`Rent-to-own deposit payment confirmed for application ${applicationId}.`);
    if (application?.company_id) {
      const amountPaid = (session.amount_total || 0) / 100;
      await supabase.from("resident_update_notifications").insert({
        company_id: application.company_id,
        resident_name: application.full_name || null,
        update_type: "rent_to_own_deposit_paid",
        message: `${application.full_name || "An applicant"} paid their Rent-to-Own deposit — $${amountPaid.toFixed(2)}.`,
      });
    }
  }
}

// Aug 4 (per Mely): reuses the same real Checkr integration already built
// for lease-application occupants — creates a real Checkr candidate +
// invitation (email sent automatically by Checkr) for each Household
// Occupant paid for in this checkout, one charge covering however many
// were selected on /residents/background-checks.
async function handleOccupantBackgroundCheckPaid(session: Stripe.Checkout.Session) {
  const occupantIdsRaw = session.metadata?.occupant_ids || "";
  const occupantIds = occupantIdsRaw.split(",").filter(Boolean);

  if (occupantIds.length === 0) {
    console.log("Occupant background check webhook missing occupant_ids metadata");
    return;
  }

  const { data: loadedOccupants, error } = await supabase
    .from("resident_occupants")
    .select("id, full_name, email, resident_id, company_id, background_check_fee_paid, checkr_candidate_id")
    .in("id", occupantIds);

  if (error || !loadedOccupants || loadedOccupants.length === 0) {
    console.log("Occupant background check webhook: could not load occupants", error?.message);
    return;
  }

  // Oct 20 (security review — webhook idempotency): an occupant that's
  // already marked paid AND already has a Checkr candidate was handled by
  // an earlier delivery of this same event — never invite them twice.
  const occupants = loadedOccupants.filter(
    (o: any) => !(o.background_check_fee_paid === true && o.checkr_candidate_id)
  );
  if (occupants.length === 0) {
    console.warn("Occupant background check webhook: all occupants already invited — duplicate delivery, skipping.");
    return;
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, email, company_id")
    .eq("id", occupants[0].resident_id)
    .maybeSingle();

  // Aug 10 (per Mely): the background check fee residents pay is now
  // 100% the park's revenue — MelyOS's own cut comes from a separate
  // Checkr Billing charge to the park's admin instead, not from this
  // payment. Reads the SAME admin-editable fee the checkout itself
  // charged (create-occupant-background-check-checkout-session already
  // pulls this from lease_defaults.application_fee_per_additional).
  // Also pulls the same Checkr Work Location State + Default Package the
  // admin configured in Lease Defaults, so this occupant flow uses the
  // exact same integration/settings as the main lease-application flow
  // instead of its own separate hardcoded package.
  let occupantFeeAmount = 5.0;
  let checkrWorkLocationState = "";
  let checkrPackageSlug = "";
  if (occupants[0].company_id) {
    const { data: settings } = await supabase
      .from("park_settings")
      .select("lease_defaults, checkr_work_location_state, checkr_default_package_slug")
      .eq("company_id", occupants[0].company_id)
      .maybeSingle();
    occupantFeeAmount =
      Number(settings?.lease_defaults?.application_fee_per_additional) || 5.0;
    checkrWorkLocationState = settings?.checkr_work_location_state || "";
    checkrPackageSlug = settings?.checkr_default_package_slug || "basic_plus_criminal";
  }

  if (!checkrWorkLocationState) {
    console.log(
      "Occupant background check: company hasn't set Checkr Work Location State in Lease Defaults — skipping all Checkr invitations for this checkout."
    );
    return;
  }

  for (const occupant of occupants) {
    try {
      // customId format "occupant::<occupantId>" — distinguishes this
      // from the "<applicationId>::<personKey>" format used for lease
      // applications, so the Checkr webhook can tell which table to
      // update when results come back.
      const { candidateId } = await createCheckrInvitation({
        applicationId: "occupant",
        personKey: occupant.id,
        email: occupant.email || resident?.email || "",
        fullName: occupant.full_name,
        state: checkrWorkLocationState,
        packageSlug: checkrPackageSlug,
      });

      await supabase
        .from("resident_occupants")
        .update({
          checkr_candidate_id: candidateId,
          background_check_status: "invitation_sent",
          background_check_fee_paid: true,
          park_share_amount: occupantFeeAmount,
          park_share_paid_out: false,
          checkr_package_slug: checkrPackageSlug,
          checkr_invitation_sent_at: new Date().toISOString(),
        })
        .eq("id", occupant.id);
    } catch (err: any) {
      console.log(`Could not create Checkr invitation for occupant ${occupant.id}:`, err.message);
    }
  }

  if (resident?.company_id) {
    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: occupants[0].resident_id,
      resident_name: resident.full_name || null,
      update_type: "occupant_background_check_paid",
      message: `${resident.full_name || "A resident"} paid for a background check for: ${occupants
        .map((o) => o.full_name)
        .join(", ")}.`,
    });
  }
}

async function handleManualReservationPaid(session: Stripe.Checkout.Session) {
  const lotOrderId = session.metadata?.lot_order_id;
  if (!lotOrderId) {
    console.log("Manual reservation webhook missing lot_order_id metadata");
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  // Oct 20 (security review): only mark the order paid if what was
  // actually paid covers the saved reservation amount.
  {
    const { data: order } = await supabase.from("lot_orders").select("amount_total, status").eq("id", lotOrderId).maybeSingle();
    const dueCents = Math.round(Number((order as any)?.amount_total || 0) * 100);
    if (!order) {
      console.log("Manual reservation webhook: lot_order not found", lotOrderId);
      return;
    }
    if ((order as any).status === "paid") return; // retried delivery
    if (Number(session.amount_total || 0) + 1 < dueCents) {
      console.error("Manual reservation webhook: paid less than the reservation amount", { lotOrderId, paid: session.amount_total, dueCents });
      return;
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
    .select("customer_name, lot_id, arrival_date, departure_date")
    .single();

  if (error) {
    console.log("Error updating lot_orders after manual reservation payment:", error.message);
    return;
  }

  console.log(`Manual reservation payment confirmed for lot_order ${lotOrderId}.`);

  // Notify the admin — they created this reservation as "pending" and have
  // no other way of knowing exactly when the guest actually completes payment.
  if (updatedOrder?.lot_id) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("company_id")
      .eq("lot_name", updatedOrder.lot_id)
      .single();

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
