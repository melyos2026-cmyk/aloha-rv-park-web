import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/get-available-lots?company_id=...&locked_lot_id=...
// Aug 6 (per Mely: every function must work correctly with several
// applicants/residents at once): the Apply form's lot dropdown previously
// showed EVERY lot regardless of status — occupied, reserved, all of it —
// letting an applicant select a lot someone already lives in or that's
// already held by another pending application. This only returns lots
// that are genuinely available right now.
//
// Aug 8 (per Mely): a lot the admin already assigned to THIS applicant at
// invite time is typically marked Reserved (no longer "available"), so it
// silently dropped out of this list — the locked <select>'s bound value
// then matched no <option>, and the browser fell back to showing "Select
// a lot..." even though the real lot was correctly saved underneath (the
// same class of value-not-in-option-list bug as the Aug 7 Billing Month
// dropdown issue). locked_lot_id, when passed, is always included
// regardless of its current status.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  const lockedLotId = req.nextUrl.searchParams.get("locked_lot_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const columns =
    "id, lot_name, base_price, max_length_ft, max_width_ft, amp_service, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing, max_driver_slide_outs, max_passenger_slide_outs";

  const { data, error } = await supabase
    .from("rv_lots")
    .select(columns)
    .eq("company_id", companyId)
    .eq("status", "available")
    .order("lot_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let lots = data || [];

  if (lockedLotId && !lots.some((lot) => lot.id === lockedLotId)) {
    const { data: lockedLot } = await supabase
      .from("rv_lots")
      .select(columns)
      .eq("id", lockedLotId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (lockedLot) {
      lots = [...lots, lockedLot].sort((a, b) => a.lot_name.localeCompare(b.lot_name));
    }
  }

  return NextResponse.json({ lots });
}
