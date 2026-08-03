import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/fee-settings?residentId=...
// FOUND (Aug 3): company_fee_settings was being read directly with the
// anon key client-side (residents/dashboard/page.tsx), which is very
// likely blocked by RLS the same way resident_occupants/resident_vehicles
// were (see commit 6730b12) — this would silently make autopayAvailable
// always false, hiding the Autopay section entirely regardless of the
// actual setting. Moved to a server route (Service Role Key) to rule this
// out for good, matching the established fix pattern in this codebase.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: residentError } = await supabase
    .from("resident_accounts")
    .select("company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (residentError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { data: feeSettings, error } = await supabase
    .from("company_fee_settings")
    .select("accept_online_payments, autopay_available")
    .eq("company_id", resident.company_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    // Online payments are always accepted (Aug 3) — no longer a toggle in
    // admin's Fee Settings, so this ignores whatever's stored in the
    // column and is just always true.
    acceptOnlinePayments: true,
    autopayAvailable: !!feeSettings?.autopay_available,
  });
}
