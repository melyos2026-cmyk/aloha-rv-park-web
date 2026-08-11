import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-pets
// Body: { residentId, petsAllowed, petsCount, petsTypes }
// Aug 11 (per Mely): the "Parking & Pets" card is otherwise read-only for
// the resident (parking, sticker IDs, clickers, mailbox keys are all
// admin-issued) — Pets is the one exception, since residents genuinely
// get new pets over time and should be able to update that themselves.
// Same pattern as save-resident-info: any real change notifies the admin.
export async function POST(req: NextRequest) {
  const { residentId, petsAllowed, petsCount, petsTypes } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: fetchError } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id, pets_allowed, pets_count, pets_types")
    .eq("id", residentId)
    .maybeSingle();

  if (fetchError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const newPetsAllowed = !!petsAllowed;
  const newPetsCount = petsCount != null && petsCount !== "" ? Number(petsCount) : null;
  const newPetsTypes = (petsTypes || "").toString().trim();

  const changed =
    newPetsAllowed !== !!resident.pets_allowed ||
    newPetsCount !== resident.pets_count ||
    newPetsTypes !== (resident.pets_types || "");

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      pets_allowed: newPetsAllowed,
      pets_count: newPetsCount,
      pets_types: newPetsTypes || null,
    })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (changed) {
    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: residentId,
      resident_name: resident.full_name,
      update_type: "pets_update",
      message: newPetsAllowed
        ? `${resident.full_name} updated their pets: ${newPetsCount || 0} pet(s)${newPetsTypes ? ` (${newPetsTypes})` : ""}.`
        : `${resident.full_name} removed all pets from their account.`,
    });
  }

  return NextResponse.json({ success: true });
}
