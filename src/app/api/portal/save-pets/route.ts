import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { refuseStorageAccount } from "@/lib/storageAccountGuard";

// POST /api/portal/save-pets
// Body: { residentId, petsAllowed, petsCount, petsTypes }
// Aug 11 (per Mely): the "Parking & Pets" card is otherwise read-only for
// the resident (parking, sticker IDs, clickers, mailbox keys are all
// admin-issued) — Pets is the one exception, since residents genuinely
// get new pets over time and should be able to update that themselves.
// Same pattern as save-resident-info: any real change notifies the admin.
export async function POST(req: NextRequest) {
  const { residentId, petsAllowed, petsCount, petsTypes, petDetails } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  // Oct 30 (storage-only customers): refused on the server too (no lot / lease / household).
  { const storageRefused = await refuseStorageAccount(residentId); if (storageRefused) return storageRefused; }

  const { data: resident, error: fetchError } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id, pets_allowed, pets_count, pets_types, pet_details")
    .eq("id", residentId)
    .maybeSingle();

  if (fetchError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const newPetsAllowed = !!petsAllowed;
  // Oct 19 (per Mely — Aloha paper form): per-pet details. When sent, the
  // count and type summary are derived from them so they never disagree.
  const cleanDetails = Array.isArray(petDetails)
    ? petDetails.slice(0, 10).map((p: any) => ({
        type: String(p?.type || "").trim(),
        name: String(p?.name || "").trim(),
        breed: String(p?.breed || "").trim(),
        color: String(p?.color || "").trim(),
        weight: String(p?.weight || "").trim(),
        shots_provided: p?.shots_provided === "yes" ? "yes" : p?.shots_provided === "no" ? "no" : "",
      }))
    : null;
  const summarize = (list: any[]) => {
    const counts: Record<string, number> = {};
    for (const p of list) {
      const t = (p.type || "").toLowerCase();
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(", ");
  };
  const newPetDetails = newPetsAllowed ? cleanDetails : [];
  const newPetsCount = newPetDetails
    ? newPetDetails.length || null
    : petsCount != null && petsCount !== "" ? Number(petsCount) : null;
  const newPetsTypes = newPetDetails
    ? summarize(newPetDetails)
    : (petsTypes || "").toString().trim();

  const changed =
    newPetsAllowed !== !!resident.pets_allowed ||
    newPetsCount !== resident.pets_count ||
    newPetsTypes !== (resident.pets_types || "") ||
    (newPetDetails !== null && JSON.stringify(newPetDetails) !== JSON.stringify(resident.pet_details || []));

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      pets_allowed: newPetsAllowed,
      pets_count: newPetsCount,
      pets_types: newPetsTypes || null,
      ...(newPetDetails !== null ? { pet_details: newPetDetails } : {}),
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
