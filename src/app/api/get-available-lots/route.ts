import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/get-available-lots?company_id=...
// Aug 6 (per Mely: every function must work correctly with several
// applicants/residents at once): the Apply form's lot dropdown previously
// showed EVERY lot regardless of status — occupied, reserved, all of it —
// letting an applicant select a lot someone already lives in or that's
// already held by another pending application. This only returns lots
// that are genuinely available right now.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("rv_lots")
    .select(
      "id, lot_name, base_price, max_length_ft, max_width_ft, amp_service, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing"
    )
    .eq("company_id", companyId)
    .eq("status", "available")
    .order("lot_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lots: data || [] });
}
