import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { normalizeReturnedFeeSettings, melyosShareOfReturnedFee, returnedPaymentFee as feeOf, decodeReturnedFeeRule, encodeReturnedFeeRule, RETURNED_BANK_COST, BILLED_SHARE, melyosReturnedCharge, FLORIDA_RETURNED_FEE, FLAT_FOUR_RETURNED_FEE, type ReturnedFeeSettings } from "@/lib/returnedFeeRules";

// Aug 4 (per Mely): the processing-fee surcharge shown to whoever pays it
// (resident or park, per company_fee_settings.pass_processing_fee_to_resident)
// is 4% of the charge, OR this fixed minimum, WHICHEVER IS GREATER. Needed
// because Stripe's own cut (2.9% + $0.30 per charge, plus Connect's
// 0.25% + $0.25 per payout once a connected account is involved) eats
// almost all of a flat 4% on small charges — a $18 propane order nets
// MelyOS roughly -$0.39 on a bare 4%, not a profit. The minimum guarantees
// a small real margin even on the smallest charges (propane starts at $18).
//
// Sep 24 (per Mely): lowered from 4%/$1.50 to 3.5%/$2.25 — less sticker
// shock for residents paying by card, betting on more residents actually
// using the system over time outweighing the lower per-transaction margin
// on large charges (verified: still profitable at every amount, but a
// ~$850 rent charge nets roughly $4 less per month than at 4%).
export const PROCESSING_FEE_PERCENT = 0.035;
export const PROCESSING_FEE_MINIMUM = 2.25;

// Oct 24 (per Mely): bank (ACH) payments. Stripe charges MelyOS 0.8% capped at $5, so a $3,000
// annual slip costs ~$5 instead of ~$105 by card.
// Oct 28 (per Mely): the surcharge shown to the payer (every company — RV parks and marinas) is
// 1.2%, at least $2.00 and at most $9.95 — still far cheaper than a card on big invoices, and a
// steady margin for MelyOS on every bank payment.
export const ACH_FEE_PERCENT = 0.012;
export const ACH_FEE_MINIMUM = 2.0;
export const ACH_FEE_MAXIMUM = 9.95;
// Oct 28 (per Mely): Stripe charges MelyOS $4 when a bank returns (bounces) an ACH payment.
// Disclosed at checkout; on an RV-park invoice it is added as a "Returned bank payment fee" line.
export const ACH_RETURN_FEE = 4.0;
// charge_type of that invoice line (written by the Stripe webhook).
export const RETURNED_ACH_FEE_CHARGE_TYPE = "Returned bank payment fee";

// Oct 28 (per Mely — owner-approved): the returned-bank-payment fee is a PER-COMPANY setting
// (company_fee_settings.returned_fee_* / melyos_returned_share_*, scratchpad returned_fee_settings.sql)
// — rules in src/lib/returnedFeeRules.ts (Florida standard $29–$35, or a custom fee schedule; MelyOS
// gets all of it or a fixed share ≥ $4). Before that SQL runs: RV parks = Florida, marinas = flat $4,
// all to MelyOS (today's behavior). If the customer never pays it, nobody is charged.
export {
  returnedPaymentFee, returnedFeePhrase, returnedFeeDisclosure, melyosShareOfReturnedFee, normalizeReturnedFeeSettings,
  validateReturnedFeeSettings, FLORIDA_RETURNED_FEE, FLAT_FOUR_RETURNED_FEE, RETURNED_BANK_COST,
  encodeReturnedFeeRule, decodeReturnedFeeRule,
} from "@/lib/returnedFeeRules";
export type { ReturnedFeeSettings } from "@/lib/returnedFeeRules";

const RETURNED_FEE_COLUMNS = "returned_fee_mode, returned_fee_flat, returned_fee_percent, returned_fee_cap, melyos_returned_share_mode, melyos_returned_share_amount";
const isMissingColumnErr = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /returned_fee_|melyos_returned_share_/.test(String(e.message || "")));

// Oct 28 (review): the rule to CHARGE with. null = could not be read (a marina is then charged NO fee
// and System Health is told — never a fee the company may not have). Columns missing (SQL not run) →
// today's behavior: RV parks Florida standard, marinas flat $4. No row: RV parks Florida (the default);
// marinas flat $4 (existing marinas are set to flat $4 by returned_fee_settings.sql — the owner
// decides per marina; a NEW marina gets the Florida default once its Fee Settings row exists).
export async function loadReturnedFeeSettingsStrict(companyId: string | null | undefined, kind: "rv" | "marina" = "rv"): Promise<ReturnedFeeSettings | null> {
  const columnsMissing = kind === "marina" ? FLAT_FOUR_RETURNED_FEE : FLORIDA_RETURNED_FEE;
  const noRow = kind === "marina" ? FLAT_FOUR_RETURNED_FEE : FLORIDA_RETURNED_FEE;
  if (!companyId) return kind === "marina" ? null : FLORIDA_RETURNED_FEE;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Oct 28 (new money model): + melyos_returned_charge (returned_fee_billing_model.sql). With it, a
    // company with no row gets the new default ("billed": the fee is the company's, MelyOS bills $9.95).
    const r1 = await supabase.from("company_fee_settings").select(`${RETURNED_FEE_COLUMNS}, melyos_returned_charge`).eq("company_id", companyId).maybeSingle();
    if (!r1.error) return r1.data ? normalizeReturnedFeeSettings(r1.data as any, { ...noRow, ...BILLED_SHARE }) : { ...noRow, ...BILLED_SHARE };
    if (!/melyos_returned_charge/.test(String(r1.error.message || "")) && !isMissingColumnErr(r1.error)) continue;
    // Before that SQL: the previous model.
    const { data, error } = await supabase.from("company_fee_settings").select(RETURNED_FEE_COLUMNS).eq("company_id", companyId).maybeSingle();
    if (!error) return data ? normalizeReturnedFeeSettings(data as any, noRow) : noRow;
    if (isMissingColumnErr(error)) return columnsMissing;
  }
  if (kind === "rv") return FLORIDA_RETURNED_FEE; // RV parks: the Florida standard is disclosed everywhere since Oct 28
  await logSystemHealthIssue({
    companyId, issueType: "melyos_fee_split", source: "stripe",
    message: "Could not read this marina's returned-payment fee setting, so NO returned-payment fee was added for a returned bank payment. Add it by hand if it applies.",
  }).catch(() => null);
  return null;
}
// For disclosures (portal texts): the same rule; on a read failure, the safe default wording.
export async function loadReturnedFeeSettings(companyId: string | null | undefined, kind: "rv" | "marina" = "rv"): Promise<ReturnedFeeSettings> {
  const s = await loadReturnedFeeSettingsStrict(companyId, kind).catch(() => null);
  return s || (kind === "marina" ? FLAT_FOUR_RETURNED_FEE : FLORIDA_RETURNED_FEE);
}

// Oct 28 (review — never charge an undisclosed fee): which rule applies to a RETURNED payment, by when
// that payment was created (and, for autopay, when the payer accepted the autopay terms):
//  - RV parks: $4.00 was disclosed since bank payments launched; the company rule ($29–$35 / custom)
//    since RV_RETURNED_FEE_RULE_DISCLOSED_SINCE. Earlier → flat $4.00.
//  - Marinas: no returned-payment fee was disclosed before MARINA_RETURNED_FEE_DISCLOSED_SINCE.
//    Earlier → no fee (null).
// Set these to the real deploy times.
export const RV_RETURNED_FEE_RULE_DISCLOSED_SINCE = "2026-10-28T23:50:25Z"; // tiered-fee deploy (commit e97b5a8)
export const MARINA_RETURNED_FEE_DISCLOSED_SINCE = "2026-10-29T01:15:00Z"; // marina returned-fee deploy
export function returnedFeeRuleForPayment(kind: "rv" | "marina", companyRule: ReturnedFeeSettings | null, paymentCreated: number | string | Date | null | undefined, autopayAuthorizedAt?: string | null): ReturnedFeeSettings | null {
  const since = Date.parse(kind === "marina" ? MARINA_RETURNED_FEE_DISCLOSED_SINCE : RV_RETURNED_FEE_RULE_DISCLOSED_SINCE);
  const created = typeof paymentCreated === "number" ? paymentCreated * 1000 : paymentCreated ? new Date(paymentCreated).getTime() : NaN;
  const authOk = autopayAuthorizedAt === undefined ? true : !!autopayAuthorizedAt && Date.parse(autopayAuthorizedAt) >= since;
  const disclosed = Number.isFinite(created) && created >= since && authOk;
  if (disclosed) return companyRule;
  return kind === "marina" ? null : FLAT_FOUR_RETURNED_FEE;
}

// Oct 28 (review — freeze the disclosed rule): the rule to put in a NEW bank payment's metadata
// (returned_fee_rule): what the payer is shown now. For autopay, the rule stored when they accepted the
// autopay terms wins (else the cutoff logic for that authorization).
export async function returnedFeeRuleToDisclose(kind: "rv" | "marina", companyId: string | null | undefined, autopay?: { authorizedAt: string | null; storedRule: unknown }): Promise<string> {
  if (autopay) {
    const stored = decodeReturnedFeeRule(autopay.storedRule);
    if (stored !== undefined) return encodeReturnedFeeRule(stored);
    return encodeReturnedFeeRule(returnedFeeRuleForPayment(kind, await loadReturnedFeeSettings(companyId, kind), new Date(), autopay.authorizedAt));
  }
  return encodeReturnedFeeRule(await loadReturnedFeeSettings(companyId, kind));
}

// Oct 28 (review): the fee for a RETURNED payment. Order: the rule frozen on the payment (metadata),
// else the rule stored with the autopay authorization, else the cutoff logic with the current rule.
// A stored rule is never replaced by a HIGHER current one (a lower current one is used — in the
// payer's favor). MelyOS's share always follows the company's current share setting (and is then
// frozen on the fee line). null = no fee.
export async function returnedFeeForReturn(p: {
  kind: "rv" | "marina"; companyId: string | null | undefined; companyName?: string | null; invoiceAmount: number;
  paymentRule?: unknown; authorizationRule?: unknown; paymentCreated: number | string | Date | null | undefined; autopayAuthorizedAt?: string | null;
}): Promise<ReturnType<typeof feeOf> | null> {
  const current = await loadReturnedFeeSettingsStrict(p.companyId, p.kind);
  const share = { shareMode: current?.shareMode ?? "all", shareAmount: current?.shareAmount ?? RETURNED_BANK_COST, melyosCharge: current?.melyosCharge };
  let stored = decodeReturnedFeeRule(p.paymentRule);
  if (stored === undefined) stored = decodeReturnedFeeRule(p.authorizationRule);
  if (stored === undefined) {
    const rule = returnedFeeRuleForPayment(p.kind, current, p.paymentCreated, p.autopayAuthorizedAt);
    return rule ? feeOf(rule, p.invoiceAmount, p.companyName) : null;
  }
  if (stored === null) return null;
  if (p.kind === "marina" && !current) return null; // the marina's setting couldn't be read (System Health told)
  const fee = feeOf({ ...stored, ...share }, p.invoiceAmount, p.companyName);
  if (current) {
    const now = feeOf(current, p.invoiceAmount, p.companyName);
    if (now.total < fee.total) return now;
  }
  return fee;
}

// Oct 28 (review): a returned-payment fee line, with MelyOS's share FROZEN on it (resident_invoice_items
// .melyos_share — returned_fee_settings.sql), so later setting changes don't change an existing fee.
// Before that column exists the line is added without it (the current setting is then used at payment).
export async function insertReturnedFeeLine(row: { invoice_id: string; charge_type: string; description: string; amount: number; melyos_share: number }) {
  const r = await supabase.from("resident_invoice_items").insert(row);
  if (r.error && (r.error.code === "42703" || r.error.code === "PGRST204" || /melyos_share/.test(r.error.message || ""))) {
    const { melyos_share: _ignored, ...rest } = row;
    return supabase.from("resident_invoice_items").insert(rest);
  }
  return r;
}

// Oct 28 (per Mely): when an invoice that carries a returned-payment fee is paid online, MelyOS's
// share of that fee (all of it, or the company's fixed share — see returnedFeeRules.ts) goes to
// MelyOS (application fee), the rest to the park. Callers subtract this from the park's share
// (never below $0); invoice totals are not changed. Best-effort: if the lookup fails the payment
// still goes through (as before) and System Health is told.
// Oct 28 (new model): { total: every returned-payment fee on these invoices (never taxed), melyos: the
// part of it that goes to MelyOS (0 for fees under the "billed" model — those are the company's) }.
export async function returnedAchFeeTotalsOnInvoices(invoiceIds: string[], companyId?: string | null): Promise<{ total: number; melyos: number }> {
  const ids = invoiceIds.filter(Boolean);
  if (ids.length === 0) return { total: 0, melyos: 0 };
  const { data, error } = await supabase.from("resident_invoice_items").select("amount").in("invoice_id", ids).eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE);
  if (error) {
    // Oct 28 (review): fail safe — never tax the fee or route it wrongly. The caller refuses the
    // checkout with a "try again" message (ReturnedFeeLookupError).
    console.error("returnedAchFeeTotalsOnInvoices:", error.message);
    if (companyId) {
      await logSystemHealthIssue({
        companyId, issueType: "melyos_fee_split", source: "stripe",
        message: `Could not check invoices ${ids.join(", ")} for a returned bank payment fee before charging (${error.message}). The payment was not started; the payer was asked to try again.`,
      }).catch(() => null);
    }
    throw new ReturnedFeeLookupError();
  }
  const total = Math.round((data || []).reduce((a, r: any) => a + Math.max(Number(r.amount) || 0, 0), 0) * 100) / 100;
  const melyos = total > 0 ? await returnedAchFeesOnInvoices(ids, companyId) : 0;
  return { total, melyos };
}
export class ReturnedFeeLookupError extends Error {
  constructor() { super("We couldn't check your balance right now. Please try again in a minute."); this.name = "ReturnedFeeLookupError"; }
}
export async function returnedAchFeesOnInvoices(invoiceIds: string[], companyId?: string | null): Promise<number> {
  const ids = invoiceIds.filter(Boolean);
  if (ids.length === 0) return 0;
  // MelyOS's share as frozen on the line when it was added; the current setting only for older lines.
  let { data, error } = await supabase
    .from("resident_invoice_items")
    .select("amount, melyos_share")
    .in("invoice_id", ids)
    .eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE) as { data: { amount: number; melyos_share?: number | null }[] | null; error: any };
  if (error && (error.code === "42703" || error.code === "PGRST204" || /melyos_share/.test(error.message || ""))) {
    ({ data, error } = await supabase.from("resident_invoice_items").select("amount").in("invoice_id", ids).eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE) as any);
  }
  if (error) {
    console.error("returnedAchFeesOnInvoices:", error.message);
    if (companyId) {
      await logSystemHealthIssue({
        companyId, issueType: "melyos_fee_split", source: "stripe",
        message: `Could not check invoices ${ids.join(", ")} for a returned bank payment fee before charging (${error.message}). If one is there, that fee went to the park instead of MelyOS.`,
      }).catch(() => null);
    }
    return 0;
  }
  if (!data || data.length === 0) return 0;
  const needsSetting = data.some((r) => r.melyos_share === null || r.melyos_share === undefined);
  const settings = needsSetting ? await loadReturnedFeeSettings(companyId, "rv") : FLORIDA_RETURNED_FEE;
  return Math.round(data.reduce((sum, r) => {
    const amt = Math.max(Number(r.amount) || 0, 0);
    const frozen = r.melyos_share === null || r.melyos_share === undefined ? null : Number(r.melyos_share);
    return sum + (frozen !== null && Number.isFinite(frozen) ? Math.min(amt, Math.max(frozen, 0)) : melyosShareOfReturnedFee(settings, amt));
  }, 0) * 100) / 100;
}
// Oct 29 (live-money audit): always whole cents. Stripe charges whole cents, and the webhook matches
// the fee line it adds against processing_fee_charged — an unrounded 3.5% (e.g. 29.0465) never matched.
export const roundCents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function calculateAchFee(amount: number): number {
  return roundCents(Math.min(Math.max(amount * ACH_FEE_PERCENT, ACH_FEE_MINIMUM), ACH_FEE_MAXIMUM));
}

export function calculateProcessingFee(amount: number): number {
  const percentFee = amount * PROCESSING_FEE_PERCENT;
  return roundCents(Math.max(percentFee, PROCESSING_FEE_MINIMUM));
}

// Aug 4: Stripe's own real cut, so callers can compute MelyOS's actual net
// margin if needed for reporting — not used to change what's charged, only
// for anyone auditing the numbers later.
export function estimateStripeCut(totalChargeAmount: number): number {
  return totalChargeAmount * 0.029 + 0.3;
}

export interface ConnectSplit {
  connectedAccountId: string;
  applicationFeeAmountCents: number;
  // Oct 9 (per Mely): short park name appended to MelyOS LLC on the
  // resident's card statement ("MELYOS LLC* ALOHA RV") so they know where
  // the money is going. Undefined if it can't be derived safely.
  statementDescriptorSuffix?: string;
}

// Stripe: suffix + account prefix must total 5-22 chars, and may not
// contain < > \ ' " *. Keep the suffix short (<=10, whole words) so it
// fits after any reasonable prefix.
export function buildStatementSuffix(companyName?: string | null): string | undefined {
  if (!companyName) return undefined;
  const words = companyName
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? out + " " + w : w;
    if (next.length > 10) break;
    out = next;
  }
  return out.length >= 2 ? out : undefined;
}

// Aug 4 (per Mely, Phase 2): looks up whether this company has a real
// connected Stripe account on file. Returns null if not connected yet —
// callers should charge normally (no split) in that case, so a company
// that hasn't connected yet isn't blocked from taking payments at all.
// alohaShare is what the connected account (the park) should end up with;
// application_fee_amount (what MelyOS keeps) = totalChargeAmount - alohaShare.
export async function resolveConnectSplit(
  companyId: string,
  totalChargeAmount: number,
  alohaShare: number
): Promise<ConnectSplit | null> {
  const { data: settings } = await supabase
    .from("park_settings")
    .select("stripe_connect_account_id, stripe_connect_onboarded")
    .eq("company_id", companyId)
    .maybeSingle();

  const { data: company } = await supabase
    .from("companies")
    .select("company_name")
    .eq("id", companyId)
    .maybeSingle();

  if (!settings?.stripe_connect_account_id || !settings.stripe_connect_onboarded) {
    return null;
  }

  // Oct 29 (live-money audit): cents first, so MelyOS's part is never off by a fraction of a cent.
  const melyOsShare = Math.max(roundCents(totalChargeAmount) - roundCents(alohaShare), 0);

  return {
    connectedAccountId: settings.stripe_connect_account_id,
    applicationFeeAmountCents: Math.round(melyOsShare * 100),
    statementDescriptorSuffix: buildStatementSuffix(company?.company_name),
  };
}

// Oct 28 (review): the autopay authorization's stored returned-fee rule (returned_fee_rule jsonb —
// returned_fee_settings.sql) and when it was accepted. Works before the column exists (rule = null).
export async function loadAutopayAuthorizationRule(table: "resident_accounts" | "marina_members", id: string, companyId: string) {
  let { data, error } = await supabase.from(table).select("autopay_authorized_at, returned_fee_rule").eq("id", id).eq("company_id", companyId).maybeSingle() as { data: any; error: any };
  if (error) ({ data } = await supabase.from(table).select("autopay_authorized_at").eq("id", id).eq("company_id", companyId).maybeSingle() as any);
  return { authorizedAt: (data?.autopay_authorized_at as string | null) ?? null, rule: data?.returned_fee_rule ?? null };
}
// Saves the rule shown with an autopay authorization (no-op before the column exists).
export async function saveAutopayAuthorizationRule(table: "resident_accounts" | "marina_members", id: string, companyId: string, kind: "rv" | "marina") {
  const rule = JSON.parse(encodeReturnedFeeRule(await loadReturnedFeeSettings(companyId, kind)));
  await supabase.from(table).update({ returned_fee_rule: rule }).eq("id", id).eq("company_id", companyId).then(() => null, () => null);
}

// Oct 28 (per Mely — new money model, "like Stripe charges MelyOS, MelyOS charges the company"): the
// moment a bank payment is RETURNED (and it really reached the bank), MelyOS bills the COMPANY its
// fixed "Returned bank payment (MelyOS)" charge (company_fee_settings.melyos_returned_charge, default
// $9.95) — whether or not the customer ever pays the returned-payment fee. Recorded in
// melyos_billing_charges (added to the company's monthly MelyOS invoice), ONCE per returned
// PaymentIntent (source "Returned bank payment <pi>"; unique index from returned_fee_billing_model.sql;
// a 23505 = already billed). Only under the "billed" model; never for demo companies. Best-effort.
export const MELYOS_RETURNED_CHARGE_TYPE = "Returned bank payment (MelyOS)";
export async function billCompanyForReturnedPayment(p: { companyId: string; paymentIntentId: string | null | undefined; payerName?: string | null; amount: number; kind: "rv" | "marina" }) {
  try {
    if (!p.companyId || !p.paymentIntentId) return;
    const { data: co } = await supabase.from("companies").select("is_demo, domain").eq("id", p.companyId).maybeSingle();
    if (!co || co.is_demo === true || /(^|\.)melyos\.io$/i.test(String(co.domain || ""))) return;
    const settings = await loadReturnedFeeSettingsStrict(p.companyId, p.kind);
    if (!settings) {
      // Oct 28 (review): unreadable — nothing billed blindly, but MelyOS can bill it by hand.
      await logSystemHealthIssue({
        companyId: p.companyId, issueType: "melyos_fee_split", source: "stripe",
        message: `A bank payment of $${Number(p.amount || 0).toFixed(2)}${p.payerName ? ` (${p.payerName})` : ""} was returned, but the company's settings could not be read, so MelyOS's "Returned bank payment (MelyOS)" charge was NOT recorded. Bill it by hand (source "Returned bank payment ${p.paymentIntentId}").`,
      }).catch(() => null);
      return;
    }
    const charge = melyosReturnedCharge(settings);
    if (!(charge > 0)) return; // older model: MelyOS's part comes from the customer's fee instead
    const source = `Returned bank payment ${p.paymentIntentId}`;
    const { data: had } = await supabase.from("melyos_billing_charges").select("id").eq("company_id", p.companyId).eq("source", source).limit(1);
    if (had && had.length > 0) return;
    const { data: last } = await supabase.from("melyos_billing_charges").select("billing_seq").eq("company_id", p.companyId).order("billing_seq", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase.from("melyos_billing_charges").insert({
      company_id: p.companyId,
      billing_seq: (last?.billing_seq || 0) + 1,
      charge_date: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
      charge_type: MELYOS_RETURNED_CHARGE_TYPE,
      source,
      description: `${p.payerName || "A customer"}'s bank payment of $${Number(p.amount || 0).toFixed(2)} was returned by the bank. MelyOS charge per returned bank payment (the bank charges MelyOS for every return).`,
      amount: Math.round(charge * 100) / 100,
      markup: 0,
    });
    if (error && error.code !== "23505") {
      await logSystemHealthIssue({ companyId: p.companyId, issueType: "melyos_fee_split", source: "stripe", message: `A bank payment was returned (${p.paymentIntentId}), but MelyOS's $${charge.toFixed(2)} charge could not be recorded (${error.message}). Add it to MelyOS Fees Owed by hand.` }).catch(() => null);
    }
  } catch (e: any) {
    console.error("billCompanyForReturnedPayment:", e?.message);
  }
}
