import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { customerFeeRatio } from "@/lib/platformFee";

// GET /api/get-processing-fee-settings?company_id=...
// Aug 17 (per Mely — the 4% card processing fee needed to show up as its
// own line item in the "Charged Today" preview BEFORE the applicant pays,
// not just get silently added at Stripe checkout time. A lease applicant
// has no portal session yet (no resident account exists until they're
// approved), so the existing /api/portal/fee-settings (session-gated)
// can't be reused here — this is the public, no-auth counterpart,
// exposing nothing more sensitive than a single boolean toggle.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const { data: feeSettings, error } = await supabase
    .from("company_fee_settings")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    passProcessingFeeToResident: customerFeeRatio(feeSettings) > 0,
    // Nov 22 (per Mely): the part of the Online Service Fee the customer pays (0..1, Fee Settings split).
    customerFeeRatio: customerFeeRatio(feeSettings),
    // Propane/storage always charged the buyer the full fee unless the park sets a split.
    alwaysCustomerFeeRatio: customerFeeRatio(feeSettings, { ignorePassSwitch: true }),
  });
}
