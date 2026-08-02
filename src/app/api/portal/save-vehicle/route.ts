import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-vehicle
// Body: { residentId, vehicleId?, make, model, year, color, plate, state }
// Replaces the previous direct client-side Supabase inserts/updates to
// resident_vehicles in residents/dashboard/page.tsx (addVehicle). Behavior
// (which fields get saved, that updates don't fire a notification but new
// vehicles do) is unchanged from the original client code.
export async function POST(req: NextRequest) {
  const { residentId, vehicleId, make, model, year, color, plate, state } = await req.json();

  if (!residentId || !plate || !plate.trim()) {
    return NextResponse.json({ error: "residentId and plate are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  if (vehicleId) {
    // SECURITY: confirm this vehicle actually belongs to the session's own
    // resident before letting them edit it — otherwise anyone could edit a
    // different resident's vehicle just by knowing/guessing its id.
    const { data: existing } = await supabase
      .from("resident_vehicles")
      .select("id, resident_id")
      .eq("id", vehicleId)
      .maybeSingle();

    if (!existing || existing.resident_id !== residentId) {
      return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("resident_vehicles")
      .update({
        vehicle_make: (make || "").trim(),
        vehicle_model: (model || "").trim(),
        vehicle_year: (year || "").trim(),
        color: (color || "").trim(),
        license_plate: plate.trim(),
        license_state: (state || "").trim(),
      })
      .eq("id", vehicleId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { error } = await supabase.from("resident_vehicles").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    vehicle_make: (make || "").trim(),
    vehicle_model: (model || "").trim(),
    vehicle_year: (year || "").trim(),
    color: (color || "").trim(),
    license_plate: plate.trim(),
    license_state: (state || "").trim(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    resident_name: resident.full_name,
    update_type: "vehicle_added",
    message: `${resident.full_name} added a new vehicle: ${year} ${make} ${model} (Plate: ${plate}).`,
  });

  return NextResponse.json({ success: true });
}
