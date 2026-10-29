import Stripe from "stripe";
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";

// Oct 29 (live-money audit H1 — owner decision pending, SAFE non-blocking version): when a park has
// no connected + onboarded Stripe account, resolveConnectSplit() returns null and an RV checkout
// still charges — 100% of the money lands in MelyOS's own Stripe balance. Nothing recorded that
// MelyOS holds the park's money. Now:
//  - every unsplit successful charge writes ONE "owed to park" row in park_payout_ledger (unique per
//    PaymentIntent), at the point the payment is recorded (logRvOnlinePayment calls this);
//  - one System Health issue per company per day: "Online payments are being collected without the
//    park's payment account — $X owed to the park";
//  - the MelyOS owner sees / settles the rows in MelyOS → Billing Charges — All Companies.
// REFUSE_UNSPLIT_RV_PAYMENTS (env, default off): when on, RV checkouts refuse like marinas do.
// Works before park_payout_ledger exists (scratchpad sec_money.sql): the payment is then flagged in
// System Health one by one instead (with the PaymentIntent), so nothing is lost.

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
export const PARK_SHARE_META = "park_share_cents";
export const UNSPLIT_ISSUE_TYPE = "park_payout_unsplit";

const isMissingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /park_payout_ledger/.test(String(e.message || "")));
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function refuseUnsplitRvPayments(): boolean {
  return /^(1|true|on|yes)$/i.test(String(process.env.REFUSE_UNSPLIT_RV_PAYMENTS || "").trim());
}

/** Metadata to put on every RV checkout / PaymentIntent: what the park should end up with (cents). */
export function parkShareMetadata(parkShare: number): Record<string, string> {
  return { [PARK_SHARE_META]: String(Math.max(Math.round(Number(parkShare || 0) * 100), 0)) };
}

/**
 * Call right after resolveConnectSplit() returned null in an RV checkout. When the owner turned
 * REFUSE_UNSPLIT_RV_PAYMENTS on, returns a ready 503 (and tells System Health), like marinas.
 * Otherwise null (charge as today; the ledger records what is owed to the park).
 */
export async function unsplitRefusal(companyId: string | null | undefined, what: string): Promise<NextResponse | null> {
  if (!companyId || !refuseUnsplitRvPayments()) return null;
  await logOncePerDay(companyId, "park_payout_refused",
    `An online ${what} payment was REFUSED because this park has no connected Stripe payout account (REFUSE_UNSPLIT_RV_PAYMENTS is on). Finish Stripe Connect onboarding in Settings → Stripe so residents can pay online.`);
  return NextResponse.json({ error: "Online payments aren't set up for this park yet. Please pay at the office." }, { status: 503 });
}

export async function logOncePerDay(companyId: string, issueType: string, message: string) {
  const dayStart = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}T00:00:00-05:00`).toISOString();
  const { data } = await supabase.from("system_health_issues").select("id").eq("company_id", companyId).eq("issue_type", issueType).gte("detected_at", dayStart).limit(1);
  if (data && data.length > 0) return;
  await logSystemHealthIssue({ companyId, issueType, source: "stripe", message });
}

async function isDemo(companyId: string): Promise<boolean> {
  const { data } = await supabase.from("companies").select("is_demo, domain").eq("id", companyId).maybeSingle();
  return !!data && (data.is_demo === true || /(^|\.)melyos\.io$/i.test(String(data.domain || "")));
}

/** Unsettled total owed to a company's park (net of refunds). null = could not be read. */
export async function parkOwedTotal(companyId: string): Promise<number | null> {
  const { data, error } = await supabase.from("park_payout_ledger").select("amount_owed, refunded_amount").eq("company_id", companyId).is("settled_at", null);
  if (error) return null;
  return Math.round((data || []).reduce((s, r: any) => s + Math.max(Number(r.amount_owed || 0) - Number(r.refunded_amount || 0), 0), 0) * 100) / 100;
}

/**
 * The payment `paymentIntentId` was recorded. If it was NOT split to the park's connected account,
 * record what MelyOS holds for the park. Never throws and never blocks the payment. Idempotent
 * (unique per PaymentIntent). Card/bank/autopay/checkout — any RV online payment.
 */
export async function recordUnsplitPaymentIfAny(p: {
  companyId: string | null | undefined;
  paymentIntentId: string | null | undefined;
  source: string;          // e.g. "Invoice payment (online)"
  payerName?: string | null;
  parkShareCents?: number | null; // when the caller knows it (else read from the PaymentIntent's metadata)
}): Promise<void> {
  try {
    const companyId = p.companyId || null;
    const piId = p.paymentIntentId || null;
    if (!stripe || !companyId || !piId || !/^pi_/.test(piId)) return;
    if (await isDemo(companyId)) return;

    // Already recorded (cheap check before asking Stripe).
    const { data: had, error: hadErr } = await supabase.from("park_payout_ledger").select("id").eq("stripe_payment_intent", piId).limit(1);
    if (!hadErr && had && had.length > 0) return;

    let pi: Stripe.PaymentIntent;
    try { pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] }); }
    catch (e: any) {
      await logSystemHealthIssue({ companyId, issueType: UNSPLIT_ISSUE_TYPE, source: "stripe",
        message: `Could not check whether online payment ${piId} was split to the park's payout account (${String(e?.message || "").slice(0, 160)}). Check it in Stripe: if it has no transfer to the park, MelyOS holds the park's share.` });
      return;
    }
    if (pi.status !== "succeeded") return;
    const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    const destination = pi.transfer_data?.destination || charge?.transfer_data?.destination || (pi as any).on_behalf_of || null;
    if (destination) return; // split → the park already got its share

    const totalCents = Number(pi.amount_received || pi.amount || 0);
    let owedCents: number;
    let estimated = false;
    const metaShare = Number(pi.metadata?.[PARK_SHARE_META]);
    if (p.parkShareCents != null && Number.isFinite(Number(p.parkShareCents))) owedCents = Math.round(Number(p.parkShareCents));
    else if (pi.metadata?.[PARK_SHARE_META] !== undefined && Number.isFinite(metaShare)) owedCents = Math.round(metaShare);
    else {
      // Older payment without the metadata: everything except the fee MelyOS charged on top.
      const feeDollars = Number(pi.metadata?.processing_fee_charged || 0);
      owedCents = Math.max(totalCents - Math.round((Number.isFinite(feeDollars) ? feeDollars : 0) * 100), 0);
      estimated = true;
    }
    owedCents = Math.min(Math.max(owedCents, 0), totalCents);
    if (owedCents <= 0) return;

    const row = {
      company_id: companyId,
      source: p.source.slice(0, 200),
      stripe_payment_intent: piId,
      stripe_charge_id: charge?.id || null,
      payment_total: totalCents / 100,
      amount_owed: owedCents / 100,
      estimated,
      notes: `${p.payerName ? `${p.payerName}. ` : ""}Charged without the park's connected Stripe account — the whole payment is in MelyOS's balance.${estimated ? " Park share estimated (older payment without park_share_cents)." : ""}`.slice(0, 1000),
    };
    const { error } = await supabase.from("park_payout_ledger").insert(row);
    if (error && error.code === "23505") return; // already recorded (a parallel delivery)
    if (error) {
      await logSystemHealthIssue({ companyId, issueType: UNSPLIT_ISSUE_TYPE, source: "stripe",
        message: `Online payment ${piId} (${money(totalCents / 100)}, ${p.source}) was collected WITHOUT the park's payout account — ${money(owedCents / 100)} is owed to the park, but it could not be written to the payout ledger (${isMissingTable(error) ? "park_payout_ledger is not installed — run sec_money.sql" : error.message}). Pay the park by hand.` });
      return;
    }
    const total = await parkOwedTotal(companyId);
    await logOncePerDay(companyId, UNSPLIT_ISSUE_TYPE,
      `Online payments are being collected without the park's payment account — ${money(total ?? owedCents / 100)} owed to the park. MelyOS holds this money until the park finishes Stripe Connect onboarding (Settings → Stripe) and is paid out by hand (MelyOS → Billing Charges — All Companies → Owed to parks).`);
  } catch (e: any) {
    console.error("recordUnsplitPaymentIfAny:", e?.message);
  }
}

/**
 * A refund / lost dispute on an unsplit payment: the park is owed less. `parkPart` = how much of the
 * money given back was the park's (capped at what is still owed). Idempotent per `ref`.
 *  - "reduced": the unsettled row was lowered (MelyOS gives back money it still held — nothing to bill);
 *  - "settled": the row was already paid out to the park by hand → the caller bills the park `owed`;
 *  - "none": no row (a split payment, or an older unsplit one); "error": could not be read/written.
 */
export async function reduceParkOwedForRefund(paymentIntentId: string, parkPart: number, note: string, ref: string): Promise<{ status: "reduced" | "settled" | "none" | "error"; owed: number }> {
  const { data, error } = await supabase.from("park_payout_ledger").select("id, amount_owed, refunded_amount, settled_at, notes").eq("stripe_payment_intent", paymentIntentId).maybeSingle();
  if (error) return { status: isMissingTable(error) ? "none" : "error", owed: 0 };
  if (!data) return { status: "none", owed: 0 };
  // Review M2: never more than the park actually still has of this payment (owed − already given back).
  const remaining = Math.max(Number(data.amount_owed || 0) - Number(data.refunded_amount || 0), 0);
  const part = Math.round(Math.min(Math.max(parkPart, 0), remaining) * 100) / 100;
  if (String(data.notes || "").includes(`[${ref}]`)) return { status: data.settled_at ? "settled" : "reduced", owed: 0 }; // already counted
  const notes = `${data.notes ? `${data.notes}\n` : ""}${new Date().toISOString().slice(0, 10)}: ${note} [${ref}]`.slice(0, 2000);
  if (data.settled_at) {
    // Settled (paid out by hand): the CALLER bills the park `owed` and only then calls
    // confirmSettledRefundBilled() — so a failure between the two never loses the charge (the
    // billing row itself is deduped by its source on a retry).
    return { status: "settled", owed: part };
  }
  const { error: upErr } = await supabase.from("park_payout_ledger").update({
    refunded_amount: Math.round((Number(data.refunded_amount || 0) + part) * 100) / 100, notes,
  }).eq("id", data.id).is("settled_at", null);
  return { status: upErr ? "error" : "reduced", owed: part };
}

/** What the ledger says the park was owed for this payment (null = no row). */
export async function parkOwedForPayment(paymentIntentId: string): Promise<number | null> {
  const { data, error } = await supabase.from("park_payout_ledger").select("amount_owed").eq("stripe_payment_intent", paymentIntentId).maybeSingle();
  if (error || !data) return null;
  return Number(data.amount_owed || 0);
}

/** After the park was billed for a refund on a settled row: count it (so it is never billed twice). */
export async function confirmSettledRefundBilled(paymentIntentId: string, billed: number, note: string, ref: string) {
  const { data } = await supabase.from("park_payout_ledger").select("id, refunded_amount, notes").eq("stripe_payment_intent", paymentIntentId).maybeSingle();
  if (!data || String(data.notes || "").includes(`[${ref}]`)) return;
  await supabase.from("park_payout_ledger").update({
    refunded_amount: Math.round((Number(data.refunded_amount || 0) + Math.max(billed, 0)) * 100) / 100,
    notes: `${data.notes ? `${data.notes}\n` : ""}${new Date().toISOString().slice(0, 10)}: ${note} — billed to the park [${ref}]`.slice(0, 2000),
  }).eq("id", data.id);
}
