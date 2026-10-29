import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateAchFee, resolveConnectSplit, returnedAchFeesOnInvoices, returnedFeeForReturn, returnedFeeRuleToDisclose, loadAutopayAuthorizationRule, insertReturnedFeeLine, returnedPaymentFee, FLAT_FOUR_RETURNED_FEE, RETURNED_ACH_FEE_CHARGE_TYPE } from "@/lib/platformFee";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
import { isInvoicePayableNow } from "@/lib/invoicePayable";
import { invoicesAwaitingRent } from "@/lib/invoiceRentReady";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { checkAndCompleteRentToOwnPlan } from "@/lib/rentToOwnCompletion";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import { sendBankPaymentReturnedEmail } from "@/lib/sendBankPaymentReturnedEmail";

// Oct 28 (per Mely): RV residents can pay autopay by BANK (ACH) instead of card — same Stripe
// pattern as marina autopay (src/lib/marina/autopay.ts): the bank account is saved once with a
// mandate (Stripe Checkout in "setup" mode, instant verification through Financial Connections),
// and every morning the process-autopay cron charges everything due in ONE off-session
// us_bank_account PaymentIntent, with the same ACH fee and Connect split as a one-time bank payment.
// The invoices are "Processing" while the bank clears (3–5 business days); payment_intent.succeeded
// settles them (Paid + "Bank Transfer Fee" line + receipt + Daily Close), payment_intent.payment_failed
// reopens them (Pending + the company's "Returned bank payment fee" once, autopay off). The cron also asks
// Stripe each morning (reconcileRvBankAutopay), so nothing depends only on the webhook events.
// Bank autopay only runs when the company's admin has bank payments ON (ach_enabled === true).

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export const RV_AUTOPAY_PI_TYPE = "rv_autopay";
export const RV_AUTOPAY_SETUP_TYPE = "rv_autopay_setup";
export const BANK_FEE_LABEL = "Bank Transfer Fee";
const MAX_INVOICES = 10; // metadata.invoice_ids must stay under Stripe's 500-character limit
const MARKER_SOURCE = "rv_autopay"; // markers live in stripe_processed_events (event_id, source)
const CLAIMS = "rv_autopay_claims";  // rv_ach_autopay.sql — the cron's record of each claim

// Tight: only PaymentIntents created by chargeRvBankAutopay. Marina autopay intents carry
// metadata.type "marina_autopay"; one-time portal checkouts have no PaymentIntent metadata at all.
export function isRvBankAutopayIntent(pi: Stripe.PaymentIntent | null | undefined): boolean {
  const m = pi?.metadata || {};
  return (
    !!pi &&
    m.type === RV_AUTOPAY_PI_TYPE &&
    m.source === "autopay" &&
    m.payment_method === "ach" &&
    !!m.resident_id &&
    !!m.invoice_ids &&
    (pi.payment_method_types || []).includes("us_bank_account")
  );
}

export function isMissingColumn(error: { message?: string; code?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || String(error.message || "").includes(column);
}
function isMissingTable(error: { message?: string; code?: string } | null | undefined, table: string): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || String(error.message || "").includes(table);
}

// "Pending" → "Processing" (only rows that are Pending right now — so two runs can't both claim the
// same invoice). Also stamps processing_since (stuck-payment check; the cron passes the exact stamp
// it recorded on its claim, so an abandoned claim can later be undone for exactly these rows).
// Works before that column exists (rv_ach_autopay.sql) — then stampSaved is false.
export async function markInvoicesProcessing(invoiceIds: string[], residentId?: string | null, stamp?: string) {
  const at = stamp || new Date().toISOString();
  const run = (withStamp: boolean) => {
    let q = supabase
      .from("resident_invoices")
      .update(withStamp ? { status: "Processing", processing_since: at } : { status: "Processing" })
      .in("id", invoiceIds)
      .eq("status", "Pending");
    if (residentId) q = q.eq("resident_id", residentId);
    return q.select("id");
  };
  let res = await run(true);
  let stampSaved = true;
  if (res.error && isMissingColumn(res.error, "processing_since")) { res = await run(false); stampSaved = false; }
  return { rows: (res.data || []) as { id: string }[], error: res.error, stampSaved };
}

// Back to "Pending" — only rows still "Processing".
async function reopenProcessing(invoiceIds: string[], residentId: string) {
  return supabase
    .from("resident_invoices")
    .update({ status: "Pending" })
    .in("id", invoiceIds)
    .eq("resident_id", residentId)
    .eq("status", "Processing")
    .select("id, invoice_month");
}

// Small "this happened" markers in stripe_processed_events (fails open if that table is missing).
async function setMarker(id: string) {
  await claimStripeEvent(id, MARKER_SOURCE);
  await finishStripeEvent(id, MARKER_SOURCE, true);
}
async function markerExists(id: string): Promise<boolean> {
  const { data } = await supabase.from("stripe_processed_events").select("status").eq("event_id", id).eq("source", MARKER_SOURCE).maybeSingle();
  return !!data;
}
const cancelledMarker = (piId: string) => `rv_autopay_cancelled:${piId}`;
// Oct 28 (review): every bank-autopay failure issue names the payment method it happened on, so a
// failure of an OLD bank account never blocks a NEW one (see failedSinceAuthorization).
const pmTag = (pmId: string | null | undefined) => (pmId ? ` [pm ${pmId}]` : "");
const flipMarker = (piId: string) => `rv_autopay_flip:${piId}`;

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const idsOf = (pi: Stripe.PaymentIntent) => String(pi.metadata?.invoice_ids || "").split(",").filter(Boolean);
const returnedFeeRef = (piId: string) => piId.slice(-10);
const monthStartIso = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

async function notifyOffice(resident: { id: string; company_id: string | null; full_name?: string | null }, updateType: string, message: string) {
  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: resident.id,
    resident_name: resident.full_name || null,
    update_type: updateType,
    message,
  }).then(() => null, () => null);
}

// One System Health issue per resident per kind: not again while one is open, or one was logged
// since `since`.
async function logOncePerResident(p: { companyId: string; residentId: string; issueType: string; since: string; message: string }) {
  const { data: rows } = await supabase
    .from("system_health_issues")
    .select("id, resolved, detected_at")
    .eq("company_id", p.companyId)
    .eq("resident_id", p.residentId)
    .eq("issue_type", p.issueType)
    .order("detected_at", { ascending: false })
    .limit(1);
  const last = rows?.[0];
  if (last && (last.resolved === false || String(last.detected_at || "") >= p.since)) return;
  await logSystemHealthIssue({ companyId: p.companyId, residentId: p.residentId, issueType: p.issueType, source: "process_autopay", message: p.message });
}

type AutopayResident = {
  id: string;
  company_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  full_name?: string | null;
  email?: string | null;
  autopay_authorized_at?: string | null;
};

export type BankAutopayResult =
  | { status: "none" | "paused" | "below_min" | "skipped" | "processing" | "succeeded" | "failed" | "unknown"; amount?: number; detail?: string };

// Autopay off, so tomorrow's run can't debit a failing account again. Only if the resident hasn't
// saved another method since. If the write fails, the office is told (and the cron's own guard —
// a bank failure logged since the last authorization — still blocks the next charge).
// Oct 28: returns true only when autopay was really switched off by this call (the resident email
// says "autopay was turned off" only then).
async function turnOffAutopay(resident: { id: string; company_id?: string | null; full_name?: string | null }, pmId: string | null | undefined): Promise<boolean> {
  let q = supabase.from("resident_accounts").update({ autopay_enabled: false }).eq("id", resident.id);
  if (pmId) q = q.eq("stripe_payment_method_id", pmId);
  const { data: offRows, error } = await q.select("id");
  if (error && resident.company_id) {
    await logSystemHealthIssue({
      companyId: resident.company_id, residentId: resident.id, issueType: "rv_bank_autopay_failed", source: "process_autopay",
      message: `Could not turn off autopay for ${resident.full_name || "a resident"} after a failed bank payment (${error.message}). Turn it off by hand in their account. Autopay will not charge this bank account again until they set it up again.${pmTag(pmId)}`,
    });
  }
  return !error && (offRows || []).length > 0;
}

// Oct 28 (per Mely): the invoices of a failed bank payment that are open (Pending) right now — what
// the resident email lists as "owed again".
async function owedAgainLabels(invoiceIds: string[], residentId: string): Promise<string[] | null> {
  const { data } = await supabase.from("resident_invoices").select("id, invoice_month, status").in("id", invoiceIds).eq("resident_id", residentId);
  const open = (data || []).filter((i) => i.status === "Pending");
  return open.length ? open.map((i) => i.invoice_month || "an invoice") : null;
}

// Bank failures logged for this resident's CURRENTLY saved bank account since they last accepted the
// autopay authorization: if any, bank autopay does not charge (they must set it up again) — even if
// turning autopay off failed. A failure of a previously saved account (another [pm …]) doesn't count.
async function failedSinceAuthorization(resident: AutopayResident, companyId: string): Promise<boolean> {
  if (!resident.stripe_payment_method_id) return true;
  let q = supabase
    .from("system_health_issues")
    .select("id")
    .eq("company_id", companyId)
    .eq("resident_id", resident.id)
    .in("issue_type", ["rv_bank_autopay_failed", "rv_bank_payment_returned"])
    .like("message", `%${pmTag(resident.stripe_payment_method_id).trim()}%`);
  if (resident.autopay_authorized_at) q = q.gte("detected_at", resident.autopay_authorized_at);
  const { data, error } = await q.limit(1);
  if (error) return true; // can't check → don't charge today
  return (data || []).length > 0;
}

// One resident, one day: everything due in ONE bank payment.
export async function chargeRvBankAutopay(resident: AutopayResident, todayStr: string): Promise<BankAutopayResult> {
  if (!stripe) return { status: "skipped", detail: "no_stripe" };
  if (!resident.company_id || !resident.stripe_customer_id || !resident.stripe_payment_method_id) return { status: "skipped", detail: "no_payment_method" };
  const companyId = resident.company_id;

  // Never on a demo company.
  const { data: company } = await supabase.from("companies").select("company_name, is_demo, domain").eq("id", companyId).maybeSingle();
  if (!company || company.is_demo === true || /(^|\.)melyos\.io$/i.test(String(company.domain || ""))) return { status: "skipped", detail: "demo" };

  // Re-checked at charge time (per Mely): bank autopay only while the admin has bank payments ON.
  const { data: feeSettings, error: feeErr } = await supabase
    .from("company_fee_settings")
    .select("pass_processing_fee_to_resident, ach_enabled, ach_min_amount")
    .eq("company_id", companyId)
    .maybeSingle();
  if (feeErr) return { status: "skipped", detail: "fee_settings_unreadable" };
  if (feeSettings?.ach_enabled !== true) {
    await logOncePerResident({
      companyId, residentId: resident.id, issueType: "rv_bank_autopay_paused", since: new Date(Date.now() - 30 * 86400000).toISOString(),
      message: `${resident.full_name || "A resident"} has autopay by bank, but bank (ACH) payments are turned OFF in Fee Settings, so autopay did NOT charge them (it was not switched to a card). Turn bank payments back on to resume it, or ask the resident to pay or set up card autopay.`,
    });
    return { status: "paused" };
  }
  if (await failedSinceAuthorization(resident, companyId)) return { status: "skipped", detail: "failed_since_authorization" };
  const minRaw = Number(feeSettings?.ach_min_amount ?? 100);
  const achMin = Number.isFinite(minRaw) ? minRaw : 100;
  const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;

  const { data: pendingRows, error: invErr } = await supabase
    .from("resident_invoices")
    .select("id, total_amount, due_date, invoice_month, status")
    .eq("resident_id", resident.id)
    .eq("status", "Pending")
    .lte("due_date", todayStr)
    .order("due_date", { ascending: true });
  if (invErr) return { status: "skipped", detail: invErr.message };
  const payable = (pendingRows || []).filter((i) => isInvoicePayableNow(i.invoice_month) && Number(i.total_amount || 0) > 0);
  const awaitingRent = await invoicesAwaitingRent(resident.id, payable.map((i) => ({ ...i, status: "Pending" })));
  const invoices = payable.filter((i) => !awaitingRent.has(i.id)).slice(0, MAX_INVOICES);
  if (invoices.length === 0) return { status: "none" };

  const invoiceIds = invoices.map((i) => i.id);
  const totalAmount = Math.round(invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0) * 100) / 100;
  // Same minimum as a one-time bank payment. Smaller balances wait (owner decision pending) — the
  // office is told once per resident per month.
  if (totalAmount < achMin) {
    await logOncePerResident({
      companyId, residentId: resident.id, issueType: "rv_bank_autopay_below_min", since: monthStartIso(),
      message: `Bank autopay did not charge ${resident.full_name || "a resident"}: the amount due (${money(totalAmount)}) is below the bank payment minimum (${money(achMin)}). It waits until the balance reaches the minimum, unless the resident pays it themselves.`,
    });
    return { status: "below_min", amount: totalAmount };
  }

  // The saved method must really be this resident's bank account.
  const pm = await stripe.paymentMethods.retrieve(resident.stripe_payment_method_id).catch((e: any) => {
    console.error(`bank autopay: could not read payment method for resident ${resident.id} (skipped today):`, e?.message);
    return null;
  });
  if (!pm) return { status: "skipped", detail: "payment_method_unreadable" };
  const pmCustomer = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (pm.type !== "us_bank_account" || pmCustomer !== resident.stripe_customer_id) {
    await turnOffAutopay(resident, resident.stripe_payment_method_id);
    await notifyOffice(resident, "autopay_failed", `Autopay FAILED for ${resident.full_name || "a resident"} — the saved bank account is no longer usable. Autopay has been turned off for them.`);
    await logSystemHealthIssue({
      companyId, residentId: resident.id, issueType: "rv_bank_autopay_failed", source: "process_autopay",
      message: `Bank autopay for ${resident.full_name || "a resident"} was not charged: the saved payment method is not their bank account any more. Autopay was turned off; they need to set it up again.${pmTag(resident.stripe_payment_method_id)}`,
    });
    return { status: "failed", amount: totalAmount, detail: "payment_method_not_bank" };
  }

  const { data: taxSettings } = await supabase
    .from("company_tax_settings")
    .select("enable_tax, manual_tax_rate_percent, rent_tax_mode")
    .eq("company_id", companyId)
    .maybeSingle();
  const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
  const taxEnabled = !!taxSettings?.enable_tax && taxRatePercent > 0 && taxSettings?.rent_tax_mode === "excluded";
  // Same money rules as create-checkout-session (one-time bank payment).
  const returnedAchFees = await returnedAchFeesOnInvoices(invoiceIds, companyId);
  const taxAmount = taxEnabled ? Math.round(Math.max(totalAmount - returnedAchFees, 0) * (taxRatePercent / 100) * 100) / 100 : 0;
  const achFee = Math.round(calculateAchFee(totalAmount) * 100) / 100;
  const chargeAmount = Math.round((totalAmount + taxAmount + (passFeeToResident ? achFee : 0)) * 100) / 100;
  const alohaShare = Math.max(totalAmount + taxAmount + (passFeeToResident ? 0 : -achFee) - returnedAchFees, 0);
  const connectSplit = await resolveConnectSplit(companyId, chargeAmount, alohaShare);
  const chargeCents = Math.round(chargeAmount * 100);
  const setKey = crypto.createHash("sha256").update([...invoiceIds].sort().join(",")).digest("hex").slice(0, 24);
  const idempotencyKey = `rv-autopay-ach-${resident.id}-${setKey}-${todayStr}-${chargeCents}`;

  // Record the claim BEFORE touching the invoices (rv_autopay_claims): if this run dies between the
  // claim and the charge, the next run finds it (no PaymentIntent with this claim_id after 1 hour)
  // and puts exactly these invoices back to Pending. The invoices get the claim's exact stamp.
  const stamp = new Date().toISOString();
  let claimRowId: string | null = null;
  {
    const { data, error } = await supabase.from(CLAIMS).insert({
      company_id: companyId, resident_id: resident.id, invoice_ids: invoiceIds.join(","), idempotency_key: idempotencyKey,
      claimed_at: stamp, status: "claimed",
    }).select("id").single();
    if (error && error.code === "23505") return { status: "skipped", detail: "already_claimed_today" };
    if (error && !isMissingTable(error, CLAIMS)) return { status: "skipped", detail: `claim: ${error.message}` };
    claimRowId = data?.id || null; // table missing → degrade: no claim record (stuck check still flags)
  }
  // Claim states: "claimed" = never sent to Stripe (the only state reconcile may undo by itself),
  // "sending" = create was attempted (outcome only known from Stripe), "charged", "failed", "released".
  const setClaim = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!claimRowId) return true;
    const { error } = await supabase.from(CLAIMS).update(patch).eq("id", claimRowId);
    return !error;
  };

  // Claim the invoices (Pending → Processing, only rows still Pending). A second run, or a resident
  // paying at the same moment, can't claim them again — so they can't be charged twice.
  const claim = await markInvoicesProcessing(invoiceIds, resident.id, stamp);
  if (claim.error) { await setClaim({ status: "released", note: claim.error.message.slice(0, 300) }); return { status: "skipped", detail: claim.error.message }; }
  if (claim.rows.length !== invoiceIds.length) {
    if (claim.rows.length > 0) await reopenProcessing(claim.rows.map((r) => r.id), resident.id);
    await setClaim({ status: "released", note: "invoices changed" });
    return { status: "skipped", detail: "invoices_changed" };
  }

  // Refused at once: never submitted to the bank → no returned-payment fee. Autopay off, office
  // notice and ONE System Health issue (the failure webhook for this intent then does nothing).
  let refusalCode: string | null = null; // Stripe's decline code, for the resident email
  const revertAndStop = async (why: string, piId?: string | null) => {
    if (piId) {
      await setMarker(cancelledMarker(piId));
      await setMarker(`rv_autopay_fail:${piId}`);
      await stripe!.paymentIntents.cancel(piId).catch(() => null);
    }
    await reopenProcessing(invoiceIds, resident.id);
    await setClaim({ status: "failed", payment_intent_id: piId || null, note: why.slice(0, 300) });
    const autopayOff = await turnOffAutopay(resident, resident.stripe_payment_method_id);
    await notifyOffice(resident, "autopay_failed", `Autopay FAILED for ${resident.full_name || "a resident"} (bank, ${money(chargeAmount)}): ${why}. Autopay has been turned off for them.`);
    await logSystemHealthIssue({
      companyId, residentId: resident.id, issueType: "rv_bank_autopay_failed", source: "process_autopay",
      message: `Bank autopay for ${resident.full_name || "a resident"} (${money(chargeAmount)}) was refused by Stripe/the bank before it was sent: ${why}. Nothing was taken and no returned-payment fee was added; the invoice(s) are Pending again and autopay was turned off.${piId ? ` Stripe payment ${piId}.` : ""}${pmTag(resident.stripe_payment_method_id)}`,
    });
    // Oct 28 (per Mely): tell the resident too — once per payment (marker keyed on the payment, or on
    // this run's idempotency key when Stripe never created one). Demo companies never get here.
    const owed = await owedAgainLabels(invoiceIds, resident.id);
    await sendBankPaymentReturnedEmail({
      paymentRef: piId || idempotencyKey,
      residentId: resident.id,
      companyId,
      amount: chargeAmount,
      invoiceLabels: owed || [],
      invoicesOwedAgain: !!owed,
      returnedByBank: false,
      reasonCode: refusalCode,
      reasonMessage: why,
      feeAdded: false,
      autopayTurnedOff: autopayOff,
      isAutopay: true,
    });
    return { status: "failed" as const, amount: totalAmount, detail: why };
  };

  // Mark the claim "sending" BEFORE calling Stripe. If that can't be recorded, don't send: the claim
  // stays "claimed" (= never sent), so undoing it later is always safe.
  if (!(await setClaim({ status: "sending" }))) {
    await reopenProcessing(invoiceIds, resident.id);
    await setClaim({ status: "released", note: "could not record sending" }); // if this fails too, it stays "claimed" (safe)
    console.error(`bank autopay: could not mark claim ${claimRowId} as sending — not charged today`);
    return { status: "skipped", detail: "claim_not_recorded" };
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: "usd",
      customer: resident.stripe_customer_id,
      payment_method: resident.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      payment_method_types: ["us_bank_account"],
      description: `Autopay (bank) — ${company.company_name || "RV park"}: ${invoices.map((i) => i.invoice_month).filter(Boolean).join(", ")}`.slice(0, 900),
      ...(connectSplit
        ? {
            application_fee_amount: connectSplit.applicationFeeAmountCents,
            transfer_data: { destination: connectSplit.connectedAccountId },
            ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
          }
        : {}),
      metadata: {
        type: RV_AUTOPAY_PI_TYPE,
        source: "autopay",
        payment_method: "ach",
        resident_id: resident.id,
        company_id: companyId,
        invoice_ids: invoiceIds.join(","),
        processing_fee_charged: passFeeToResident ? String(achFee) : "0",
        tax_charged: String(taxAmount),
        tax_rate_percent: String(taxRatePercent),
        ...(claimRowId ? { claim_id: claimRowId } : {}),
        // Oct 28 (review): the returned-payment fee rule the resident accepted with bank autopay.
        returned_fee_rule: await (async () => { const a = await loadAutopayAuthorizationRule("resident_accounts", resident.id, companyId); return returnedFeeRuleToDisclose("rv", companyId, { authorizedAt: a.authorizedAt ?? resident.autopay_authorized_at ?? null, storedRule: a.rule }); })(),
      },
    }, { idempotencyKey });
  } catch (e: any) {
    const errPi = e?.raw?.payment_intent as Stripe.PaymentIntent | undefined;
    if (errPi && (errPi.status === "processing" || errPi.status === "succeeded")) {
      pi = errPi;
    } else if (!errPi && (e?.type === "StripeConnectionError" || e?.type === "StripeAPIError" || e?.type === "StripeRateLimitError")) {
      // Outcome unknown (Stripe didn't answer). The invoices stay "Processing" — never charge again
      // blindly. The next run's reconcile looks for this claim's payment in Stripe after an hour:
      // found → handled normally; not found → review by the office (never undone automatically).
      await logSystemHealthIssue({
        companyId, residentId: resident.id, issueType: "rv_bank_autopay_unknown", source: "process_autopay",
        message: `Bank autopay for ${resident.full_name || "a resident"} (${money(chargeAmount)}) got no answer from Stripe (${String(e?.message || "").slice(0, 200)}). The invoice(s) were left "Processing" so they are not charged twice; the next autopay run checks Stripe; if it finds no payment, the office is asked to review it.${claimRowId ? "" : " (Claim records are not set up — run rv_ach_autopay.sql — so check Stripe → Payments by hand: if there is no payment, set the invoice(s) back to Pending.)"}`,
      });
      return { status: "unknown", amount: totalAmount }; // claim stays "sending" → never auto-undone
    } else {
      refusalCode = e?.raw?.decline_code || e?.raw?.code || e?.code || null;
      return revertAndStop(String(e?.raw?.message || e?.message || "the bank payment was refused").slice(0, 200), errPi?.id || null);
    }
  }

  if (pi.status !== "processing" && pi.status !== "succeeded") refusalCode = pi.last_payment_error?.code || null;
  if (pi.status !== "processing" && pi.status !== "succeeded") return revertAndStop(`payment ${pi.status.replace(/_/g, " ")}`, pi.id);
  // Retried once; if it still fails the claim stays "sending" — reconcile then links it by claim_id
  // or (if Stripe search misses it) sends it to review, never back to Pending.
  if (!(await setClaim({ status: "charged", payment_intent_id: pi.id })) && !(await setClaim({ status: "charged", payment_intent_id: pi.id }))) {
    console.error(`bank autopay: claim ${claimRowId} charged with ${pi.id} but could not be marked charged`);
    await logSystemHealthIssue({
      companyId, residentId: resident.id, issueType: "rv_bank_autopay_claim_unrecorded", source: "process_autopay",
      message: `Bank autopay charged ${resident.full_name || "a resident"} ${money(chargeAmount)} (Stripe payment ${pi.id}), but the claim record ${claimRowId} could not be updated. Nothing to do unless this payment later shows up for review; it is settled normally when the bank confirms.`,
    });
  }
  if (pi.status === "succeeded") {
    await settleRvBankAutopay(pi);
    return { status: "succeeded", amount: totalAmount };
  }
  await notifyOffice(resident, "autopay_charged", `Autopay started a bank payment of ${money(chargeAmount)} for ${resident.full_name || "a resident"} (${invoices.map((i) => i.invoice_month).filter(Boolean).join(", ")}). It clears in 3–5 business days.`);
  return { status: "processing", amount: totalAmount };
}

// The bank confirmed a bank-autopay payment. Same paid path as a portal payment: Paid, fee/tax lines,
// receipt, office notice, Daily Close. Safe to call many times (webhook + reconcile):
//  - claimed once per PaymentIntent (stripe_processed_events "rv_autopay_settle:<pi>");
//  - already in Daily Close (rv_shift_payments source_id = pi) → nothing to do;
//  - only invoices still "Processing" are flipped, and the lines are added only to one of those.
// Invoices of this payment that are NOT Processing (already Paid another way, reopened, …) are
// raised as rv_possible_duplicate_payment — except Paid ones that this same payment flipped on an
// earlier try (marker "rv_autopay_flip:<pi>").
export async function settleRvBankAutopay(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  if (!isRvBankAutopayIntent(pi) || pi.status !== "succeeded") return { ok: true, detail: "not_applicable" };
  const claimId = `rv_autopay_settle:${pi.id}`;
  if ((await claimStripeEvent(claimId, MARKER_SOURCE)) === "duplicate") return { ok: true, detail: "duplicate" };
  try {
    const r = await settleInner(pi);
    await finishStripeEvent(claimId, MARKER_SOURCE, r.ok);
    return r;
  } catch (e: any) {
    await finishStripeEvent(claimId, MARKER_SOURCE, false);
    console.error("settleRvBankAutopay:", pi.id, e?.message);
    return { ok: false, detail: e?.message };
  }
}

async function settleInner(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  const m = pi.metadata;
  const residentId = m.resident_id;
  const invoiceIds = idsOf(pi);
  const fee = Number(m.processing_fee_charged || 0);
  const tax = Number(m.tax_charged || 0);
  const taxRatePercent = Number(m.tax_rate_percent || 0);
  const amountCents = Number(pi.amount_received || pi.amount || 0);

  const { data: resident } = await supabase.from("resident_accounts").select("id, full_name, email, company_id").eq("id", residentId).maybeSingle();
  if (!resident || (m.company_id && resident.company_id !== m.company_id)) {
    console.error("settleRvBankAutopay: resident/company mismatch for", pi.id);
    return { ok: true, detail: "resident_mismatch" };
  }
  const companyId = resident.company_id as string;

  const { data: ledger } = await supabase.from("rv_shift_payments").select("id").eq("company_id", companyId).eq("source_type", "stripe_online").eq("source_id", pi.id).limit(1);
  if (ledger && ledger.length > 0) return { ok: true, detail: "already_settled" };

  const { data: invoices, error: invErr } = await supabase
    .from("resident_invoices")
    .select("id, total_amount, invoice_month, status")
    .in("id", invoiceIds)
    .eq("resident_id", residentId);
  if (invErr) return { ok: false, detail: invErr.message };
  const processing = invoiceIds.map((id) => (invoices || []).find((i) => i.id === id)).filter((i): i is NonNullable<typeof i> => !!i && i.status === "Processing");
  const flippedEarlier = await markerExists(flipMarker(pi.id));
  const odd = (invoices || []).filter((i) => i.status !== "Processing" && !(i.status === "Paid" && flippedEarlier));

  if (processing.length > 0) {
    const primary = processing[0];
    const { data: primaryLines, error: linesErr } = await supabase.from("resident_invoice_items").select("charge_type, amount").eq("invoice_id", primary.id);
    if (linesErr) return { ok: false, detail: linesErr.message };
    const hasLine = (type: string, amount: number) => (primaryLines || []).some((l) => l.charge_type === type && Math.abs(Number(l.amount || 0) - amount) < 0.01);
    const taxThere = tax > 0 && hasLine("Sales Tax", tax);
    const feeThere = fee > 0 && hasLine(BANK_FEE_LABEL, fee);

    if (!taxThere && !feeThere) {
      const invoicesTotal = processing.reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const expectedCents = Math.round((invoicesTotal + tax + fee) * 100);
      if (Math.abs(expectedCents - amountCents) > 2) {
        await logSystemHealthIssue({
          companyId, residentId, issueType: "rv_payment_amount_mismatch", source: "stripe_webhook",
          message: `A bank autopay payment collected ${money(amountCents / 100)} but the invoice(s) it paid now add up to ${money(expectedCents / 100)} (invoice totals + tax + fee). A charge was probably added or removed while the bank payment was clearing. The invoice(s) were marked Paid — check them and bill or credit the difference. Stripe payment ${pi.id}.`,
        });
      }
    }
    if (tax > 0 && !taxThere) {
      const { error } = await supabase.from("resident_invoice_items").insert({ invoice_id: primary.id, charge_type: "Sales Tax", description: `Sales Tax (${taxRatePercent}%)`, amount: tax });
      if (error) return { ok: false, detail: error.message };
    }
    if (fee > 0 && !feeThere) {
      const { error } = await supabase.from("resident_invoice_items").insert({ invoice_id: primary.id, charge_type: BANK_FEE_LABEL, description: BANK_FEE_LABEL, amount: fee });
      if (error) return { ok: false, detail: error.message };
    }
    if (tax > 0 || fee > 0) {
      const { data: allItems, error } = await supabase.from("resident_invoice_items").select("amount").eq("invoice_id", primary.id);
      if (error) return { ok: false, detail: error.message };
      const total = (allItems || []).reduce((s, it) => s + Number(it.amount || 0), 0);
      const { error: totErr } = await supabase.from("resident_invoices").update({ total_amount: total }).eq("id", primary.id);
      if (totErr) return { ok: false, detail: totErr.message };
    }
    await setMarker(flipMarker(pi.id)); // so a retry knows the Paid ones are ours
    const { error: paidErr } = await supabase
      .from("resident_invoices")
      .update({ status: "Paid" })
      .in("id", processing.map((i) => i.id))
      .eq("status", "Processing");
    if (paidErr) return { ok: false, detail: paidErr.message }; // retried; the lines above are not added twice
  }

  if (odd.length > 0) {
    await logSystemHealthIssue({
      companyId, residentId, issueType: "rv_possible_duplicate_payment", source: "stripe_webhook",
      message: `${resident.full_name || "A resident"}'s bank AUTOPAY payment of ${money(amountCents / 100)} cleared, but ${odd.length} of its ${invoiceIds.length} invoice(s) were no longer "Processing": ${odd.map((i) => `${i.invoice_month || "invoice"} (${i.status}, ${money(Number(i.total_amount || 0))}, ${i.id})`).join("; ")}. If one was already paid another way this is a duplicate payment — review it for a refund in Stripe; if one is Pending it may be charged again. Stripe payment ${pi.id}.`,
    });
  }

  // The money arrived either way: it goes to Daily Close (once — upsert on the payment id).
  await logRvOnlinePayment({
    companyId, sourceId: pi.id, description: "Autopay by bank (online)",
    payerName: resident.full_name, amountCents, reference: pi.id,
  });
  if (processing.length === 0) return { ok: true, detail: "nothing_processing" };
  await checkAndCompleteRentToOwnPlan(residentId, companyId).catch(() => null);

  try {
    const { data: items } = await supabase.from("resident_invoice_items").select("invoice_id, description, charge_type, amount").in("invoice_id", processing.map((i) => i.id));
    const chargesPaid = processing.flatMap((inv) => {
      const list = (items || []).filter((it) => it.invoice_id === inv.id);
      return list.length > 0
        ? list.map((it) => ({ label: it.description || it.charge_type || "Charge", amount: Number(it.amount || 0) }))
        : [{ label: `Invoice — ${inv.invoice_month}`, amount: Number(inv.total_amount || 0) }];
    });
    const { data: stillOpen } = await supabase.from("resident_invoices").select("total_amount").eq("resident_id", residentId).eq("status", "Pending");
    const remainingBalance = (stillOpen || []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
    if (resident.email) {
      await sendReceiptEmail({
        toEmail: resident.email,
        residentName: resident.full_name || "Resident",
        amountPaid: amountCents / 100,
        chargesPaid,
        receiptNumber: pi.id,
        transactionId: pi.id,
        paymentDate: new Date(),
        remainingBalance,
      });
    }
  } catch (e: any) {
    console.error("settleRvBankAutopay receipt:", e?.message);
  }
  await notifyOffice(resident, "autopay_charged", `Autopay bank payment of ${money(amountCents / 100)} from ${resident.full_name || "a resident"} cleared (${processing.map((i) => i.invoice_month).filter(Boolean).join(", ")}).`);
  return { ok: true };
}

// A bank-autopay payment failed (the bank returned it, or it was refused). Always: invoices
// "Processing" → "Pending", autopay off, office notice, ONE System Health issue. The tiered ($29–$35)
// "Returned bank payment fee" is added once — except when the payment never reached the bank
// (we canceled it — marker "rv_autopay_cancelled:<pi>" — or Stripe shows no charge on it).
// Safe to call many times: claimed once per PaymentIntent; a System Health issue naming this
// payment means it was already handled; the fee line carries this payment's ref.
export async function failRvBankAutopay(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  if (!isRvBankAutopayIntent(pi)) return { ok: true, detail: "not_applicable" };
  const claimId = `rv_autopay_fail:${pi.id}`;
  if ((await claimStripeEvent(claimId, MARKER_SOURCE)) === "duplicate") return { ok: true, detail: "duplicate" };
  try {
    const r = await failInner(pi);
    await finishStripeEvent(claimId, MARKER_SOURCE, r.ok);
    return r;
  } catch (e: any) {
    await finishStripeEvent(claimId, MARKER_SOURCE, false);
    console.error("failRvBankAutopay:", pi.id, e?.message);
    return { ok: false, detail: e?.message };
  }
}

async function failInner(pi: Stripe.PaymentIntent): Promise<{ ok: boolean; detail?: string }> {
  const residentId = pi.metadata.resident_id;
  const invoiceIds = idsOf(pi);
  const ref = returnedFeeRef(pi.id);
  const { data: resident } = await supabase.from("resident_accounts").select("id, full_name, company_id, stripe_payment_method_id, autopay_authorized_at").eq("id", residentId).maybeSingle();
  if (!resident || (pi.metadata.company_id && resident.company_id !== pi.metadata.company_id)) return { ok: true, detail: "resident_mismatch" };
  const companyId = resident.company_id as string;
  // Oct 28 (per Mely): the company's own returned-payment fee rule (src/lib/returnedFeeRules.ts), on the
  // INVOICE amount (without the bank transfer fee and the sales tax).
  const { data: feeCompany } = await supabase.from("companies").select("company_name").eq("id", companyId).maybeSingle();
  // Oct 28 (review): only the fee disclosed when the payment was made AND in the autopay terms the
  // resident accepted (accepted before the company rule was disclosed → flat $4 until they set it up again).
  // Oct 28 (review): the rule frozen on this payment (metadata), else the one stored with the autopay
  // authorization, else the cutoff logic; never a higher current rule.
  const invoiceAmount = Math.max(Number(pi.amount || 0) / 100 - Number(pi.metadata?.processing_fee_charged || 0) - Number(pi.metadata?.tax_charged || 0), 0);
  const auth = await loadAutopayAuthorizationRule("resident_accounts", resident.id, companyId);
  const returnFee = (await returnedFeeForReturn({
    kind: "rv", companyId, companyName: feeCompany?.company_name || null, invoiceAmount,
    paymentRule: pi.metadata?.returned_fee_rule, authorizationRule: auth.rule,
    paymentCreated: pi.created, autopayAuthorizedAt: (resident as any).autopay_authorized_at ?? auth.authorizedAt ?? null,
  })) || returnedPaymentFee(FLAT_FOUR_RETURNED_FEE, invoiceAmount, feeCompany?.company_name || null); // RV: $4 was always disclosed

  const { data: logged, error: loggedErr } = await supabase
    .from("system_health_issues").select("id")
    .eq("company_id", companyId).in("issue_type", ["rv_bank_payment_returned", "rv_bank_autopay_failed"]).like("message", `%${pi.id}%`).limit(1);
  if (loggedErr) return { ok: false, detail: loggedErr.message };
  if (logged && logged.length > 0) return { ok: true, detail: "already_handled" };

  // Never reached the bank → no returned-payment fee.
  const neverSubmitted = pi.status === "canceled" || !pi.latest_charge || (await markerExists(cancelledMarker(pi.id)));

  const { data: reopened, error: reopenErr } = await reopenProcessing(invoiceIds, residentId);
  if (reopenErr) return { ok: false, detail: reopenErr.message };

  let feeInvoice: { id: string; invoice_month?: string | null } | null = null;
  if (!neverSubmitted) {
    const { data: existingFee, error: feeLookupErr } = await supabase
      .from("resident_invoice_items").select("id, invoice_id, amount")
      .in("invoice_id", invoiceIds).eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE).like("description", `%${ref}%`).limit(1);
    if (feeLookupErr) return { ok: false, detail: feeLookupErr.message };
    const { data: invoices } = await supabase.from("resident_invoices").select("id, status, invoice_month").in("id", invoiceIds).eq("resident_id", residentId);
    if (existingFee && existingFee.length > 0) {
      feeInvoice = { id: existingFee[0].invoice_id, invoice_month: (invoices || []).find((i) => i.id === existingFee[0].invoice_id)?.invoice_month };
      // A retry: the line already added is what counts.
      const was = Number((existingFee[0] as any).amount) || 0;
      if (was > 0) { returnFee.total = was; returnFee.melyosShare = Math.min(was, returnFee.melyosShare); returnFee.companyShare = Math.round((was - returnFee.melyosShare) * 100) / 100; }
    } else {
      const target = invoiceIds.map((id) => (invoices || []).find((i) => i.id === id)).find((i) => i?.status === "Pending");
      if (target) {
        const { error } = await insertReturnedFeeLine({
          invoice_id: target.id, charge_type: RETURNED_ACH_FEE_CHARGE_TYPE, description: `${returnFee.description} (ref ${ref})`, amount: returnFee.total,
          melyos_share: returnFee.melyosShare, // frozen now
        });
        if (error) return { ok: false, detail: error.message };
        feeInvoice = { id: target.id, invoice_month: target.invoice_month };
      }
    }
    if (feeInvoice) {
      const { data: allItems, error } = await supabase.from("resident_invoice_items").select("amount").eq("invoice_id", feeInvoice.id);
      if (error) return { ok: false, detail: error.message };
      const total = (allItems || []).reduce((s, it) => s + Number(it.amount || 0), 0);
      const { error: totErr } = await supabase.from("resident_invoices").update({ total_amount: total }).eq("id", feeInvoice.id);
      if (totErr) return { ok: false, detail: totErr.message };
    }
  }

  // Autopay off (a failed bank payment must not be retried automatically tomorrow) — but only when
  // the failed payment used the bank account that is saved NOW. A late return of an older account
  // (the resident has since saved a new one) leaves the current autopay alone, and says so.
  const failedPm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id || null;
  const currentPm = resident.stripe_payment_method_id || null;
  const samePm = !failedPm || !currentPm || failedPm === currentPm;
  const autopayOff = samePm ? await turnOffAutopay(resident, failedPm || currentPm) : false;
  const autopayNote = samePm
    ? "Autopay was turned off."
    : "This was an OLDER bank account — the resident has saved a different payment method since, so their current autopay was NOT changed.";
  await notifyOffice(resident, "autopay_failed", samePm
    ? `Autopay bank payment for ${resident.full_name || "a resident"} ${neverSubmitted ? "failed" : "was RETURNED by the bank"} — autopay has been turned off for them.`
    : `An older autopay bank payment for ${resident.full_name || "a resident"} (from a previously saved bank account) ${neverSubmitted ? "failed" : "was RETURNED by the bank"}. Their current autopay was not changed.`);
  const reason = pi.last_payment_error?.message || "";
  const n = invoiceIds.length === 1 ? "The invoice is" : "The invoices are";
  await logSystemHealthIssue({
    companyId, residentId,
    issueType: neverSubmitted ? "rv_bank_autopay_failed" : "rv_bank_payment_returned",
    source: "stripe_webhook",
    message: (neverSubmitted
      ? `${resident.full_name || "A resident"}'s bank AUTOPAY payment of ${money(Number(pi.amount || 0) / 100)} failed before reaching the bank${reason ? ` (${reason})` : ""}. Nothing was taken and no returned-payment fee was added. ${(reopened || []).length ? `${n} back to Pending. ` : ""}${autopayNote} Stripe payment ${pi.id}.`
      : `${resident.full_name || "A resident"}'s bank AUTOPAY payment of ${money(Number(pi.amount || 0) / 100)} was returned by the bank${reason ? ` (${reason})` : ""}. ${(reopened || []).length ? `${n} back to Pending (owed again). ` : ""}${autopayNote} ${feeInvoice ? `A ${money(returnFee.total)} returned bank payment fee (${returnFee.description}${returnFee.companyShare > 0 ? `; when paid, ${money(returnFee.melyosShare)} goes to MelyOS and ${money(returnFee.companyShare)} to the park` : "; all of it goes to MelyOS when paid"}) was added to the ${feeInvoice.invoice_month || ""} invoice.` : `No invoice was open to add the ${money(returnFee.total)} returned bank payment fee to — add it by hand if it applies.`} Contact the resident to pay again. Stripe payment ${pi.id}.`) + pmTag(failedPm || currentPm),
  });
  // Oct 28 (per Mely): email the resident — after the issue above (which makes every later call of
  // this function return "already_handled"), plus its own per-payment marker: sent once.
  let reasonCode: string | null = pi.last_payment_error?.code || null;
  if (!neverSubmitted && pi.latest_charge) {
    const ch = typeof pi.latest_charge === "string" ? await stripe?.charges.retrieve(pi.latest_charge).catch(() => null) : pi.latest_charge;
    reasonCode = ch?.failure_code || reasonCode;
  }
  const owed = await owedAgainLabels(invoiceIds, residentId);
  await sendBankPaymentReturnedEmail({
    paymentRef: pi.id,
    residentId,
    companyId,
    amount: Number(pi.amount || 0) / 100,
    invoiceLabels: owed || [],
    invoicesOwedAgain: !!owed,
    returnedByBank: !neverSubmitted,
    reasonCode,
    reasonMessage: reason || pi.last_payment_error?.message || null,
    feeAdded: !!feeInvoice,
    feeAmount: returnFee.total,
    feeBankPart: returnFee.serviceCharge !== null ? returnFee.bankFee : undefined,
    feeServicePart: returnFee.serviceCharge ?? undefined,
    feeExplanation: returnFee.serviceCharge === null ? returnFee.description : undefined,
    autopayTurnedOff: autopayOff,
    isAutopay: true,
  });
  return { ok: true };
}

// Claims the cron recorded but never finished. After 1 hour, Stripe is searched by claim_id:
//  - found → link it (settled/failed by the normal path);
//  - not found + "claimed" (never sent to Stripe) → put EXACTLY those invoices back to Pending (only
//    rows still Processing with the claim's own processing_since stamp) and tell the office once;
//  - not found + "sending" (create was attempted — the search may simply miss it) → "needs_review" +
//    one System Health issue. Never undone automatically.
async function reconcileAbandonedClaims(): Promise<{ released: number; linked: number }> {
  let released = 0, linked = 0;
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: claims, error } = await supabase.from(CLAIMS).select("*").in("status", ["claimed", "sending"]).lt("claimed_at", hourAgo).limit(100);
  if (error) {
    if (!isMissingTable(error, CLAIMS)) console.error("reconcileAbandonedClaims:", error.message);
    return { released, linked }; // table missing → degrade (the 7-day stuck check still flags them)
  }
  for (const c of claims || []) {
    const found = await stripe!.paymentIntents.search({ query: `metadata['claim_id']:'${c.id}'`, limit: 1 }).catch(() => null);
    if (!found) continue; // can't ask Stripe now → next run
    const pi = found.data[0];
    if (pi) {
      await supabase.from(CLAIMS).update({ status: "charged", payment_intent_id: pi.id }).eq("id", c.id);
      if (pi.status === "succeeded") await settleRvBankAutopay(pi);
      else if (pi.status === "requires_payment_method" || pi.status === "canceled") await failRvBankAutopay(pi);
      linked++;
      continue;
    }
    const ids = String(c.invoice_ids || "").split(",").filter(Boolean);
    if (c.status !== "claimed") {
      const { error: revErr } = await supabase.from(CLAIMS).update({ status: "needs_review", note: "sent to Stripe, no payment found by search" }).eq("id", c.id).eq("status", c.status);
      if (revErr) continue; // try again next run (one issue only once the claim is marked)
      await logSystemHealthIssue({
        companyId: c.company_id, residentId: c.resident_id, issueType: "rv_bank_autopay_needs_review", source: "process_autopay",
        message: `A bank autopay charge was sent to Stripe for invoice(s) ${ids.join(", ")}, but its result could not be confirmed (Stripe search finds no payment for claim ${c.id}). The invoice(s) were left "Processing" and NOT changed automatically. Check Stripe → Payments for this resident: if a payment exists it will be settled when the bank confirms; if there is none, set the invoice(s) back to Pending.`,
      });
      continue;
    }
    const { data: back, error: backErr } = await supabase
      .from("resident_invoices")
      .update({ status: "Pending" })
      .in("id", ids)
      .eq("resident_id", c.resident_id)
      .eq("status", "Processing")
      .eq("processing_since", c.claimed_at)
      .select("id, invoice_month");
    if (backErr) {
      // processing_since missing: can't tell these rows from a newer bank payment — don't guess.
      await supabase.from(CLAIMS).update({ status: "needs_review", note: backErr.message.slice(0, 300) }).eq("id", c.id);
      await logSystemHealthIssue({
        companyId: c.company_id, residentId: c.resident_id, issueType: "rv_bank_autopay_abandoned", source: "process_autopay",
        message: `A bank autopay run claimed invoice(s) ${ids.join(", ")} but stopped before charging (no payment in Stripe). They could not be put back automatically — if they are still "Processing" with no payment in Stripe, set them back to Pending.`,
      });
      continue;
    }
    await supabase.from(CLAIMS).update({ status: "released", note: "no payment in Stripe after 1 hour" }).eq("id", c.id);
    await logSystemHealthIssue({
      companyId: c.company_id, residentId: c.resident_id, issueType: "rv_bank_autopay_abandoned", source: "process_autopay",
      message: `A bank autopay run claimed invoice(s) but stopped before charging — Stripe has no payment for it. ${(back || []).length ? `${(back || []).map((b) => b.invoice_month || b.id).join(", ")} put back to Pending (nothing was taken).` : "No invoice needed to be put back."} Claim ${c.id}.`,
    });
    released++;
  }
  return { released, linked };
}

// Every morning (process-autopay): ask Stripe about recent bank-autopay payments and settle or fail
// them — so it works even if the payment_intent.* webhook events are not enabled. Each call above is
// idempotent, so payments the webhook already handled are skipped. Then abandoned claims.
export async function reconcileRvBankAutopay(): Promise<{ settled: number; failed: number; released?: number; linked?: number; error?: string }> {
  if (!stripe) return { settled: 0, failed: 0 };
  const since = Math.floor(Date.now() / 1000) - 21 * 86400;
  let settled = 0, failed = 0;
  try {
    for (const status of ["succeeded", "requires_payment_method"] as const) {
      let page: string | undefined;
      for (let i = 0; i < 10; i++) {
        const res: Stripe.ApiSearchResult<Stripe.PaymentIntent> = await stripe.paymentIntents.search({
          query: `metadata['type']:'${RV_AUTOPAY_PI_TYPE}' AND status:'${status}' AND created>${since}`,
          limit: 100,
          ...(page ? { page } : {}),
        });
        for (const pi of res.data) {
          if (status === "succeeded") { const r = await settleRvBankAutopay(pi); if (r.ok && !r.detail) settled++; }
          else { const r = await failRvBankAutopay(pi); if (r.ok && !r.detail) failed++; }
        }
        if (!res.has_more || !res.next_page) break;
        page = res.next_page;
      }
    }
  } catch (e: any) {
    console.error("reconcileRvBankAutopay:", e?.message);
    return { settled, failed, error: e?.message };
  }
  const abandoned = await reconcileAbandonedClaims().catch((e: any) => { console.error("reconcileAbandonedClaims:", e?.message); return { released: 0, linked: 0 }; });
  return { settled, failed, ...abandoned };
}
