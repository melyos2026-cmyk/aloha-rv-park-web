import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit, returnedAchFeeTotalsOnInvoices } from "@/lib/platformFee";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
import { markInvoicesProcessing, disputeReopenedIds } from "@/lib/rvBankAutopay";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import { parkShareMetadata, refuseUnsplitRvPayments, logOncePerDay } from "@/lib/parkPayoutLedger";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { checkAndCompleteRentToOwnPlan } from "@/lib/rentToOwnCompletion";

// Oct 29 (live-money audit M1): RV resident autopay by CARD, with the same safety as bank autopay
// (src/lib/rvBankAutopay.ts):
//  1) the invoice is CLAIMED first (Pending → Processing, only if still Pending, with a stamp) — a
//     second cron run, or the resident paying at the same moment, can't charge it again;
//  2) the claim is written as a marker (stripe_processed_events, source "rv_autopay_card") BEFORE the
//     charge, so a run that dies in the middle is found and finished by the next run;
//  3) the PaymentIntent carries metadata (type rv_autopay_card, company_id, resident_id, invoice_ids,
//     claim_stamp, fee/tax) so refunds/disputes/reconcile can find its invoice;
//  4) succeeded → fee/tax lines (once), total recomputed, Paid (checked), Daily Close, receipt;
//     declined → back to Pending (only this claim's rows), autopay off, office + System Health;
//     no answer from Stripe → left Processing (never charged blindly again) + System Health; the
//     next run asks Stripe and finishes it either way.

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
export const RV_CARD_AUTOPAY_TYPE = "rv_autopay_card";
const MARKER_SOURCE = "rv_autopay_card";
const FEE_LABEL = "Card Processing Fee";
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const claimMarker = (invoiceId: string, stamp: string) => `card_claim:${invoiceId}:${stamp}`;

type Resident = { id: string; company_id: string | null; full_name?: string | null; email?: string | null; stripe_customer_id: string | null; stripe_payment_method_id: string | null };

async function notifyOffice(resident: { id: string; company_id: string | null; full_name?: string | null }, updateType: string, message: string) {
  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id, resident_id: resident.id, resident_name: resident.full_name || null, update_type: updateType, message,
  }).then(() => null, () => null);
}

async function reopenClaim(invoiceId: string, residentId: string, stamp: string) {
  // Only THIS claim's row (same processing_since stamp) — never a newer bank payment's.
  let r = await supabase.from("resident_invoices").update({ status: "Pending" }).eq("id", invoiceId).eq("resident_id", residentId).eq("status", "Processing").eq("processing_since", stamp).select("id");
  if (r.error && /processing_since/.test(r.error.message || "")) {
    r = await supabase.from("resident_invoices").update({ status: "Pending" }).eq("id", invoiceId).eq("resident_id", residentId).eq("status", "Processing").select("id");
  }
  return r;
}

export type CardAutopayResult = { status: "charged" | "failed" | "skipped" | "unknown"; amount?: number; detail?: string };

/** One invoice, one day. Never charges an invoice that is not Pending right now. */
export async function chargeRvCardAutopayInvoice(resident: Resident, invoice: { id: string; total_amount: number | string | null; due_date?: string | null; invoice_month?: string | null }, todayStr: string): Promise<CardAutopayResult> {
  if (!stripe) return { status: "skipped", detail: "no_stripe" };
  if (!resident.company_id || !resident.stripe_customer_id || !resident.stripe_payment_method_id) return { status: "skipped", detail: "no_payment_method" };
  const companyId = resident.company_id;
  const amount = Math.round(Number(invoice.total_amount || 0) * 100) / 100;
  if (!(amount > 0)) return { status: "skipped", detail: "nothing_due" };
  // Review B1: never auto-charge an invoice that was reopened by a lost dispute.
  const disputed = await disputeReopenedIds([invoice.id]);
  if (!disputed || disputed.has(invoice.id)) return { status: "skipped", detail: "dispute_reopened" };

  const { data: company } = await supabase.from("companies").select("company_name, address, is_demo, domain").eq("id", companyId).maybeSingle();
  if (!company || company.is_demo === true || /(^|\.)melyos\.io$/i.test(String(company.domain || ""))) return { status: "skipped", detail: "demo" };

  const { data: feeSettings } = await supabase.from("company_fee_settings").select("pass_processing_fee_to_resident").eq("company_id", companyId).maybeSingle();
  const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
  const { data: taxSettings } = await supabase.from("company_tax_settings").select("enable_tax, manual_tax_rate_percent, rent_tax_mode").eq("company_id", companyId).maybeSingle();
  const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
  const taxEnabled = !!taxSettings?.enable_tax && taxRatePercent > 0 && taxSettings?.rent_tax_mode === "excluded";

  let feeTotals: { total: number; melyos: number };
  try { feeTotals = await returnedAchFeeTotalsOnInvoices([invoice.id], companyId); } catch { return { status: "skipped", detail: "returned_fee_lookup_failed" }; }
  const taxAmount = taxEnabled ? Math.round(Math.max(amount - feeTotals.total, 0) * (taxRatePercent / 100) * 100) / 100 : 0;
  const processingFee = calculateProcessingFee(amount);
  const chargeAmount = Math.round((amount + taxAmount + (passFeeToResident ? processingFee : 0)) * 100) / 100;
  const alohaShare = Math.max(amount + taxAmount + (passFeeToResident ? 0 : -processingFee) - feeTotals.melyos, 0);
  const connectSplit = await resolveConnectSplit(companyId, chargeAmount, alohaShare);
  if (!connectSplit && refuseUnsplitRvPayments()) {
    await logOncePerDay(companyId, "park_payout_refused",
      `Autopay did NOT charge residents today (e.g. ${resident.full_name || "a resident"}, ${money(chargeAmount)}): this park has no connected Stripe payout account and REFUSE_UNSPLIT_RV_PAYMENTS is on. Finish Stripe Connect in Settings → Stripe.`);
    return { status: "skipped", detail: "unsplit_refused" };
  }

  // The saved card must be this resident's (attached to their own Stripe customer).
  const pm = await stripe.paymentMethods.retrieve(resident.stripe_payment_method_id).catch(() => null);
  if (!pm) return { status: "skipped", detail: "payment_method_unreadable" };
  const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (pm.type !== "card" || pmCustomer !== resident.stripe_customer_id) {
    await supabase.from("resident_accounts").update({ autopay_enabled: false }).eq("id", resident.id).eq("stripe_payment_method_id", resident.stripe_payment_method_id);
    await notifyOffice(resident, "autopay_failed", `Autopay FAILED for ${resident.full_name || "a resident"} — the saved card is not on their account any more. Autopay has been turned off for them.`);
    await logSystemHealthIssue({ companyId, residentId: resident.id, issueType: "rv_card_autopay_failed", source: "process_autopay",
      message: `Card autopay for ${resident.full_name || "a resident"} was not charged: the saved payment method is not a card attached to their own Stripe customer. Autopay was turned off; they need to set it up again.` });
    return { status: "failed", amount, detail: "payment_method_not_theirs" };
  }

  // 1) Claim the invoice.
  const stamp = new Date().toISOString();
  const claim = await markInvoicesProcessing([invoice.id], resident.id, stamp);
  if (claim.error) return { status: "skipped", detail: claim.error.message };
  if (claim.rows.length !== 1) return { status: "skipped", detail: "invoice_no_longer_pending" };
  // 2) The marker the next run uses to finish an interrupted claim (fails open if the table is missing).
  await claimStripeEvent(claimMarker(invoice.id, stamp), MARKER_SOURCE);

  const metadata: Record<string, string> = {
    type: RV_CARD_AUTOPAY_TYPE, source: "autopay", payment_method: "card",
    company_id: companyId, resident_id: resident.id, invoice_ids: invoice.id, claim_stamp: stamp,
    processing_fee_charged: passFeeToResident ? String(processingFee) : "0",
    tax_charged: String(taxAmount), tax_rate_percent: String(taxRatePercent),
    ...parkShareMetadata(alohaShare),
  };
  const params: Stripe.PaymentIntentCreateParams = {
    amount: Math.round(chargeAmount * 100), currency: "usd",
    customer: resident.stripe_customer_id, payment_method: resident.stripe_payment_method_id,
    off_session: true, confirm: true, payment_method_types: ["card"],
    description: `Autopay — ${company.company_name || "RV park"} invoice ${invoice.id}`,
    metadata,
    ...(connectSplit ? {
      application_fee_amount: connectSplit.applicationFeeAmountCents,
      transfer_data: { destination: connectSplit.connectedAccountId },
      ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
    } : {}),
  };
  // Same key as before (invoice + day + amount): a re-run the same day gets the SAME PaymentIntent.
  const idempotencyKey = `autopay-${invoice.id}-${todayStr}-${Math.round(chargeAmount * 100)}`;

  let pi: Stripe.PaymentIntent | null = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2 && !pi; attempt++) {
    try { pi = await stripe.paymentIntents.create(params, { idempotencyKey }); }
    catch (e: any) {
      lastErr = e;
      const errPi = e?.raw?.payment_intent as Stripe.PaymentIntent | undefined;
      if (errPi) { pi = errPi; break; }
      const transient = e?.type === "StripeConnectionError" || e?.type === "StripeAPIError" || e?.type === "StripeRateLimitError";
      if (!transient) break;
    }
  }

  if (!pi) {
    const transient = lastErr?.type === "StripeConnectionError" || lastErr?.type === "StripeAPIError" || lastErr?.type === "StripeRateLimitError";
    if (transient) {
      // Outcome unknown: leave it Processing (never charge blindly again); the next run asks Stripe.
      await logSystemHealthIssue({ companyId, residentId: resident.id, issueType: "rv_card_autopay_unknown", source: "process_autopay",
        message: `Card autopay for ${resident.full_name || "a resident"} (${money(chargeAmount)}, invoice ${invoice.invoice_month || invoice.id}) got no answer from Stripe (${String(lastErr?.message || "").slice(0, 200)}). The invoice was left "Processing" so it is not charged twice; the next autopay run checks Stripe and finishes it. Invoice ${invoice.id}.` });
      return { status: "unknown", amount };
    }
    return declined(resident, invoice, stamp, chargeAmount, String(lastErr?.raw?.message || lastErr?.message || "the card was declined").slice(0, 200), null);
  }
  if (pi.status === "succeeded") {
    const r = await finishRvCardAutopay(pi);
    return r.ok ? { status: "charged", amount } : { status: "charged", amount, detail: r.detail };
  }
  if (pi.status === "processing") {
    // Cards almost never do this; the next run's reconcile finishes it when Stripe confirms.
    return { status: "unknown", amount, detail: "processing" };
  }
  await stripe.paymentIntents.cancel(pi.id).catch(() => null);
  return declined(resident, invoice, stamp, chargeAmount, `payment ${pi.status.replace(/_/g, " ")}${pi.last_payment_error?.message ? ` — ${pi.last_payment_error.message}` : ""}`.slice(0, 200), pi.id);
}

async function declined(resident: Resident, invoice: { id: string; due_date?: string | null; invoice_month?: string | null }, stamp: string, chargeAmount: number, why: string, piId: string | null): Promise<CardAutopayResult> {
  const back = await reopenClaim(invoice.id, resident.id, stamp);
  await finishStripeEvent(claimMarker(invoice.id, stamp), MARKER_SOURCE, true);
  // A declined card is not retried every day without the resident knowing — autopay off (as before).
  await supabase.from("resident_accounts").update({ autopay_enabled: false }).eq("id", resident.id);
  await notifyOffice(resident, "autopay_failed", `Autopay FAILED for ${resident.full_name || "a resident"} (invoice due ${invoice.due_date || ""}, ${money(chargeAmount)}) — autopay has been turned off for them.`);
  if (resident.company_id) {
    await logSystemHealthIssue({ companyId: resident.company_id, residentId: resident.id, issueType: "rv_card_autopay_failed", source: "process_autopay",
      message: `Card autopay for ${resident.full_name || "a resident"} (${money(chargeAmount)}, invoice ${invoice.invoice_month || invoice.id}) failed: ${why}. Nothing was charged; ${back.error ? `the invoice could NOT be set back to Pending (${back.error.message}) — set it back by hand` : "the invoice is Pending again"} and autopay was turned off.${piId ? ` Stripe payment ${piId}.` : ""}` });
  }
  return { status: "failed", detail: why };
}

/**
 * The card was charged (PaymentIntent succeeded). Safe to call many times (cron right after the
 * charge, and every later reconcile): the payment counts once (Daily Close row per PaymentIntent),
 * the fee/tax lines are added once, and only a "Processing" invoice is flipped to Paid.
 */
export async function finishRvCardAutopay(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  const m = pi.metadata || {};
  if (m.type !== RV_CARD_AUTOPAY_TYPE || pi.status !== "succeeded" || !m.resident_id || !m.invoice_ids) return { ok: true, detail: "not_applicable" };
  // Review (Low): one finisher per PaymentIntent at a time, and once finished it is never finished
  // again — overlapping runs can't add the fee/tax lines twice, and the receipt / office notice go
  // out once per payment (not every morning's reconcile).
  const finishId = `card_finish:${pi.id}`;
  if ((await claimStripeEvent(finishId, MARKER_SOURCE)) === "duplicate") return { ok: true, detail: "already_finished" };
  try {
    const r = await finishInner(pi);
    await finishStripeEvent(finishId, MARKER_SOURCE, r.ok);
    return r;
  } catch (e: any) {
    await finishStripeEvent(finishId, MARKER_SOURCE, false);
    return { ok: false, detail: e?.message };
  }
}

async function finishInner(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  const m = pi.metadata || {};
  const invoiceId = String(m.invoice_ids).split(",")[0];
  const { data: resident } = await supabase.from("resident_accounts").select("id, full_name, email, company_id").eq("id", m.resident_id).maybeSingle();
  if (!resident || (m.company_id && resident.company_id !== m.company_id)) return { ok: true, detail: "resident_mismatch" };
  const companyId = resident.company_id as string;
  const fee = Number(m.processing_fee_charged || 0);
  const tax = Number(m.tax_charged || 0);
  const taxRatePercent = Number(m.tax_rate_percent || 0);

  const { data: inv, error: invErr } = await supabase.from("resident_invoices").select("id, status, total_amount, invoice_month, due_date").eq("id", invoiceId).eq("resident_id", resident.id).maybeSingle();
  if (invErr) return { ok: false, detail: invErr.message };
  const { data: ledger } = await supabase.from("rv_shift_payments").select("id").eq("company_id", companyId).eq("source_type", "stripe_online").eq("source_id", pi.id).limit(1);
  const alreadyCounted = !!ledger && ledger.length > 0;

  if (inv && inv.status === "Processing") {
    const { data: lines, error: linesErr } = await supabase.from("resident_invoice_items").select("charge_type, amount").eq("invoice_id", inv.id);
    if (linesErr) return { ok: false, detail: linesErr.message };
    const has = (type: string, amt: number) => (lines || []).some((l) => l.charge_type === type && Math.abs(Number(l.amount || 0) - amt) < 0.01);
    if (tax > 0 && !has("Sales Tax", tax)) {
      const { error } = await supabase.from("resident_invoice_items").insert({ invoice_id: inv.id, charge_type: "Sales Tax", description: `Sales Tax (${taxRatePercent}%)`, amount: tax });
      if (error) return { ok: false, detail: error.message };
    }
    if (fee > 0 && !has(FEE_LABEL, fee)) {
      const { error } = await supabase.from("resident_invoice_items").insert({ invoice_id: inv.id, charge_type: FEE_LABEL, description: FEE_LABEL, amount: fee });
      if (error) return { ok: false, detail: error.message };
    }
    const { data: allItems, error: itemsErr } = await supabase.from("resident_invoice_items").select("amount").eq("invoice_id", inv.id);
    if (itemsErr) return { ok: false, detail: itemsErr.message };
    const total = Math.round((allItems || []).reduce((s, it) => s + Number(it.amount || 0), 0) * 100) / 100;
    const collected = Number(pi.amount_received || pi.amount || 0) / 100;
    if (Math.abs(total - collected) > 0.02) {
      await logSystemHealthIssue({ companyId, residentId: resident.id, issueType: "rv_payment_amount_mismatch", source: "process_autopay",
        message: `Card autopay collected ${money(collected)} but invoice ${inv.invoice_month || inv.id} now adds up to ${money(total)}. A charge was probably changed while it was being paid. The invoice was marked Paid — bill or credit the difference. Stripe payment ${pi.id}.` });
    }
    let paid = await supabase.from("resident_invoices").update({ status: "Paid", total_amount: total }).eq("id", inv.id).eq("status", "Processing").select("id");
    if (paid.error) paid = await supabase.from("resident_invoices").update({ status: "Paid", total_amount: total }).eq("id", inv.id).eq("status", "Processing").select("id");
    if (paid.error) {
      await logSystemHealthIssue({ companyId, residentId: resident.id, issueType: "rv_card_autopay_unrecorded", source: "process_autopay",
        message: `Card autopay CHARGED ${resident.full_name || "a resident"} ${money(collected)} (Stripe ${pi.id}) but invoice ${inv.invoice_month || inv.id} could not be marked Paid (${paid.error.message}). It stays "Processing" (not charged again); the next autopay run tries again.` });
      return { ok: false, detail: paid.error.message };
    }
  } else if (!alreadyCounted && inv && inv.status !== "Paid") {
    // Money taken, but the invoice is not ours any more (reopened / changed by hand).
    await logSystemHealthIssue({ companyId, residentId: resident.id, issueType: "rv_possible_duplicate_payment", source: "process_autopay",
      message: `Card autopay charged ${resident.full_name || "a resident"} ${money(Number(pi.amount_received || pi.amount || 0) / 100)} for invoice ${inv.invoice_month || inv.id}, but that invoice is now "${inv.status}" (not Processing). Check it: mark it Paid if this payment covers it, or refund it in Stripe. Stripe payment ${pi.id}.` });
  }

  if (m.claim_stamp) await finishStripeEvent(claimMarker(invoiceId, m.claim_stamp), MARKER_SOURCE, true);
  if (alreadyCounted) return { ok: true, detail: "already_finished" };

  await logRvOnlinePayment({ companyId, sourceId: pi.id, description: "Autopay (online)", payerName: resident.full_name, amountCents: Number(pi.amount_received || pi.amount || 0), reference: pi.id });
  await checkAndCompleteRentToOwnPlan(resident.id, companyId).catch(() => null);
  await notifyOffice(resident, "autopay_charged", `Autopay charged ${resident.full_name || "a resident"} ${money(Number(pi.amount || 0) / 100)} for invoice due ${inv?.due_date || ""}.`);
  try {
    if (resident.email && inv) {
      const { data: items } = await supabase.from("resident_invoice_items").select("description, charge_type, amount").eq("invoice_id", inv.id);
      const { data: stillOpen } = await supabase.from("resident_invoices").select("total_amount").eq("resident_id", resident.id).eq("status", "Pending");
      const { data: co } = await supabase.from("companies").select("company_name, address").eq("id", companyId).maybeSingle();
      await sendReceiptEmail({
        toEmail: resident.email, residentName: resident.full_name || "Resident", amountPaid: Number(pi.amount || 0) / 100,
        chargesPaid: (items || []).map((it) => ({ label: it.description || it.charge_type || "Charge", amount: Number(it.amount || 0) })),
        receiptNumber: pi.id, transactionId: pi.id, paymentDate: new Date(pi.created * 1000),
        remainingBalance: (stillOpen || []).reduce((s, r) => s + Number(r.total_amount || 0), 0),
        companyName: co?.company_name || null, companyAddress: co?.address || null,
      });
    }
  } catch (e: any) { console.error("card autopay receipt:", e?.message); }
  return { ok: true };
}

/**
 * Each morning before charging: finish card-autopay claims a previous run left open.
 *  - card autopay payments of the last 14 days that succeeded → finishRvCardAutopay (idempotent);
 *  - open claim markers older than 1 hour → ask Stripe for that claim's payment: succeeded → finish;
 *    failed/canceled → back to Pending; none at all → back to Pending (nothing was charged).
 */
export async function reconcileRvCardAutopay(): Promise<{ finished: number; released: number; error?: string }> {
  if (!stripe) return { finished: 0, released: 0 };
  let finished = 0, released = 0;
  try {
    const since = Math.floor(Date.now() / 1000) - 14 * 86400;
    let page: string | undefined;
    for (let i = 0; i < 10; i++) {
      const res: Stripe.ApiSearchResult<Stripe.PaymentIntent> = await stripe.paymentIntents.search({
        query: `metadata['type']:'${RV_CARD_AUTOPAY_TYPE}' AND status:'succeeded' AND created>${since}`, limit: 100, ...(page ? { page } : {}),
      });
      for (const pi of res.data) { const r = await finishRvCardAutopay(pi); if (r.ok && !r.detail) finished++; }
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
  } catch (e: any) {
    console.error("reconcileRvCardAutopay search:", e?.message);
    return { finished, released, error: e?.message };
  }

  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: open } = await supabase.from("stripe_processed_events").select("event_id").eq("source", MARKER_SOURCE).eq("status", "processing").lt("created_at", hourAgo).limit(100);
  for (const row of open || []) {
    const match = /^card_claim:([0-9a-f-]{36}):(.+)$/i.exec(String(row.event_id));
    if (!match) continue;
    const [, invoiceId, stamp] = match;
    const found = await stripe.paymentIntents.search({ query: `metadata['type']:'${RV_CARD_AUTOPAY_TYPE}' AND metadata['claim_stamp']:'${stamp}'`, limit: 5 }).catch(() => null);
    if (!found) continue; // can't ask Stripe now → next run
    const pi = found.data.find((x) => String(x.metadata?.invoice_ids || "").split(",").includes(invoiceId)) || null;
    if (pi && pi.status === "succeeded") { await finishRvCardAutopay(pi); finished++; continue; }
    if (pi && (pi.status === "processing" || pi.status === "requires_capture")) continue;
    if (pi && pi.status !== "canceled") await stripe.paymentIntents.cancel(pi.id).catch(() => null);
    const { data: inv } = await supabase.from("resident_invoices").select("id, resident_id, company_id, invoice_month").eq("id", invoiceId).maybeSingle();
    if (inv?.resident_id) {
      const back = await reopenClaim(invoiceId, inv.resident_id, stamp);
      if (!back.error && inv.company_id) {
        await logSystemHealthIssue({ companyId: inv.company_id, residentId: inv.resident_id, issueType: "rv_card_autopay_abandoned", source: "process_autopay",
          message: `A card autopay run claimed invoice ${inv.invoice_month || invoiceId} but stopped before it was charged (${pi ? `Stripe payment ${pi.id} is ${pi.status}` : "no payment in Stripe"}). ${(back.data || []).length ? "The invoice was put back to Pending — nothing was charged." : "The invoice was no longer Processing; nothing changed."}` });
      }
      if (back.error) continue; // try again next run
    }
    await finishStripeEvent(String(row.event_id), MARKER_SOURCE, true);
    released++;
  }
  return { finished, released };
}
