import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Aug 4 (per Mely): the processing-fee surcharge shown to whoever pays it
// (resident or park, per company_fee_settings.pass_processing_fee_to_resident)
// is 4% of the charge, OR this fixed minimum, WHICHEVER IS GREATER. Needed
// because Stripe's own cut (2.9% + $0.30 per charge, plus Connect's
// 0.25% + $0.25 per payout once a connected account is involved) eats
// almost all of a flat 4% on small charges — a $18 propane order nets
// MelyOS roughly -$0.39 on a bare 4%, not a profit. The minimum guarantees
// a small real margin even on the smallest charges (propane starts at $18).
export const PROCESSING_FEE_PERCENT = 0.04;
export const PROCESSING_FEE_MINIMUM = 1.5;

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

  if (!settings?.stripe_connect_account_id || !settings.stripe_connect_onboarded) {
    return null;
  }

  const melyOsShare = Math.max(totalChargeAmount - alohaShare, 0);

  return {
    connectedAccountId: settings.stripe_connect_account_id,
    applicationFeeAmountCents: Math.round(melyOsShare * 100),
  };
}
