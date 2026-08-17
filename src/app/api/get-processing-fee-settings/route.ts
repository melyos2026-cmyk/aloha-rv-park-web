import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

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
    .select("pass_processing_fee_to_resident")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    passProcessingFeeToResident: feeSettings?.pass_processing_fee_to_resident !== false,
  });
}
