import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-rv-info
// Body: { residentId, rvMake, rvModel, rvYear, rvLengthFt, rvVinOrTag }
// Replaces a direct client-side Supabase write in
// residents/dashboard/page.tsx (saveRvInfo) found during the final sweep
// for this table — same pattern as save-resident-info.
export async function POST(req: NextRequest) {
  const { residentId, rvMake, rvModel, rvYear, rvLengthFt, rvVinOrTag } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      rv_make: (rvMake || "").trim() || null,
      rv_model: (rvModel || "").trim() || null,
      rv_year: (rvYear || "").trim() || null,
      rv_length_ft: rvLengthFt ? Number(rvLengthFt) : null,
      rv_vin_or_tag: (rvVinOrTag || "").trim() || null,
    })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
