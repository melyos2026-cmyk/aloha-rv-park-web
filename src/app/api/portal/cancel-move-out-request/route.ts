import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/cancel-move-out-request
// Body: { residentId }
// Aug 6 (per Mely): the Moving Out card stays permanently in the portal —
// a resident can change their mind even after admin already confirmed a
// date. Cancelling clears both the request and lease_end, so they can
// submit a fresh date afterward.
// NOTE: if the daily cron had already flipped the lot to "reserved" on
// the map (because the confirmed date was within the notice window),
// cancelling here does NOT automatically flip it back to "occupied" —
// that reversal isn't built yet, so admin may need to check the map/Lot
// Status Control manually after a resident cancels.
export async function POST(req: NextRequest) {
  const { residentId } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: lease, error: leaseError } = await supabase
    .from("resident_leases")
    .select("id")
    .eq("resident_id", residentId)
    .eq("status", "Active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError || !lease) {
    return NextResponse.json({ error: "No active lease found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("resident_leases")
    .update({
      requested_move_out_date: null,
      requested_move_out_note: null,
      requested_move_out_at: null,
      lease_end: null,
    })
    .eq("id", lease.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
