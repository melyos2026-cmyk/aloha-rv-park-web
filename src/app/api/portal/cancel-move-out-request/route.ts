import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/cancel-move-out-request
// Body: { residentId }
// Aug 6 (per Mely): the Moving Out card stays permanently in the portal —
// a resident can change their mind even after admin already confirmed a
// date. Cancelling clears both the request and lease_end, so they can
// submit a fresh date afterward. Also reverts the lot from "reserved"
// back to "occupied" if the daily cron already flipped it for this exact
// move-out (fixed Aug 6 — previously left the map stuck on "reserved").
export async function POST(req: NextRequest) {
  const { residentId } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  // Aug 6 (per Mely: admin never gets told a resident cancelled — neither
  // notification bell nor Resident Leases): fetch resident info so we can
  // notify the admin, matching the same notification request-move-out
  // already sends when a resident FILES a request.
  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("company_id, full_name, space_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  // Aug 6 (per Mely: no longer requires status='Active' — this is exactly
  // the case where the resident's request needs cancelling even though
  // status may have already flipped to 'Ended' by mistake.
  const { data: lease, error: leaseError } = await supabase
    .from("resident_leases")
    .select("id, lease_end")
    .eq("resident_id", residentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError || !lease) {
    return NextResponse.json({ error: "No lease found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("resident_leases")
    .update({
      requested_move_out_date: null,
      requested_move_out_note: null,
      requested_move_out_at: null,
      lease_end: null,
      status: "Active",
    })
    .eq("id", lease.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aug 6 (per Mely): if the daily cron already flipped this resident's
  // lot to "reserved" for this exact move-out (reserved_until matches the
  // date we just cleared), flip it back to "occupied" — previously this
  // reversal wasn't built, leaving the map stuck showing "reserved" after
  // a resident changed their mind.
  if (resident.space_id && lease.lease_end) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("status, reserved_until")
      .eq("id", resident.space_id)
      .maybeSingle();

    if (lot && lot.status === "reserved" && lot.reserved_until === lease.lease_end) {
      await supabase
        .from("rv_lots")
        .update({ status: "occupied", reserved_until: null })
        .eq("id", resident.space_id);
    }
  }

  let lotName: string | null = null;
  if (resident.space_id) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("lot_name")
      .eq("id", resident.space_id)
      .maybeSingle();
    lotName = lot?.lot_name || null;
  }

  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_name: resident.full_name,
    update_type: "move_out_cancelled",
    message: `${resident.full_name}${lotName ? ` (Lot ${lotName})` : ""} cancelled their move-out request.`,
  });

  return NextResponse.json({ success: true });
}
