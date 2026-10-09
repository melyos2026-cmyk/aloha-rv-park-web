import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

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
