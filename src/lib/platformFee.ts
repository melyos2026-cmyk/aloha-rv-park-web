import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";

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

// Oct 28 (per Mely — owner-approved, RV PARKS only; marinas keep the flat $4 for now): the fee the
// RESIDENT pays when their bank returns a payment = Stripe's $4.00 bank cost + a service charge as
// allowed by Florida Statute 68.065 (capped at $31): returned amount ≤ $50 → $25; ≤ $300 → $30;
// above $300 → $31. Totals $29 / $34 / $35. ALL of it goes to MelyOS (returnedAchFeesOnInvoices
// takes it out of the park's share when the resident pays online). If the resident never pays it,
// nobody is charged — the park is never responsible for it.
export function rvReturnedAchServiceCharge(returnedAmount: number): number {
  const a = Math.round(Number(returnedAmount || 0) * 100) / 100;
  if (a <= 50) return 25;
  if (a <= 300) return 30;
  return 31;
}
export function rvReturnedAchFee(returnedAmount: number): { total: number; bankFee: number; serviceCharge: number; description: string } {
  const serviceCharge = rvReturnedAchServiceCharge(returnedAmount);
  const bankFee = ACH_RETURN_FEE;
  return {
    total: Math.round((bankFee + serviceCharge) * 100) / 100,
    bankFee,
    serviceCharge,
    description: `Bank returned payment $${Number(returnedAmount || 0).toFixed(2)} ($${bankFee.toFixed(2)} bank fee + $${serviceCharge.toFixed(2)} service charge, Fla. Stat. 68.065)`,
  };
}
// Shown to RV residents wherever bank payments / bank autopay are offered.
export const RV_RETURNED_ACH_FEE_MIN = 29;
export const RV_RETURNED_ACH_FEE_MAX = 35;
export { RV_RETURNED_ACH_FEE_DISCLOSURE } from "@/lib/autopayTerms";

// Oct 28 (per Mely): the returned-payment fee is Stripe's charge to MelyOS, so when an invoice that
// carries it is paid, that amount goes to MelyOS (application fee), not to the park. Callers subtract
// this from the park's share (never below $0); invoice totals are not changed. Best-effort: if the
// lookup fails the payment still goes through (as before) and System Health is told.
export async function returnedAchFeesOnInvoices(invoiceIds: string[], companyId?: string | null): Promise<number> {
  const ids = invoiceIds.filter(Boolean);
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from("resident_invoice_items")
    .select("amount")
    .in("invoice_id", ids)
    .eq("charge_type", RETURNED_ACH_FEE_CHARGE_TYPE);
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
  return Math.round((data || []).reduce((sum, r) => sum + Math.max(Number(r.amount) || 0, 0), 0) * 100) / 100;
}
export function calculateAchFee(amount: number): number {
  return Math.min(Math.max(amount * ACH_FEE_PERCENT, ACH_FEE_MINIMUM), ACH_FEE_MAXIMUM);
}

export function calculateProcessingFee(amount: number): number {
  const percentFee = amount * PROCESSING_FEE_PERCENT;
  return Math.max(percentFee, PROCESSING_FEE_MINIMUM);
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

  const melyOsShare = Math.max(totalChargeAmount - alohaShare, 0);

  return {
    connectedAccountId: settings.stripe_connect_account_id,
    applicationFeeAmountCents: Math.round(melyOsShare * 100),
    statementDescriptorSuffix: buildStatementSuffix(company?.company_name),
  };
}
