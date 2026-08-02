import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/delete-vehicle
// Body: { residentId, vehicleId }
// Replaces the previous direct client-side Supabase delete in
// residents/dashboard/page.tsx (deleteVehicle).
export async function POST(req: NextRequest) {
  const { residentId, vehicleId } = await req.json();

  if (!residentId || !vehicleId) {
    return NextResponse.json({ error: "residentId and vehicleId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  // SECURITY: confirm this vehicle actually belongs to the session's own
  // resident before deleting it — otherwise anyone could remove a
  // different resident's vehicle just by knowing/guessing its id.
  const { data: existing } = await supabase
    .from("resident_vehicles")
    .select("id, resident_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (!existing || existing.resident_id !== residentId) {
    return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  }

  const { error } = await supabase.from("resident_vehicles").delete().eq("id", vehicleId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
