import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-resident-info
// Body: { residentId, phone, email, emergencyContactName,
//         emergencyContactPhone, emergencyContactRelationship }
// Replaces the previous direct client-side Supabase write in
// residents/dashboard/page.tsx (saveResidentInfo), which was protected only
// by RLS (if any) rather than by the real session check added below.
export async function POST(req: NextRequest) {
  const {
    residentId,
    phone,
    email,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelationship,
  } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: fetchError } = await supabase
    .from("resident_accounts")
    .select(
      "full_name, company_id, phone, email, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship"
    )
    .eq("id", residentId)
    .maybeSingle();

  if (fetchError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  // Mely's rule (Aug 3): ANY info the resident adds or changes in their own
  // account must notify the admin — build the list of what actually
  // changed before writing, so the notification is specific and useful
  // instead of a generic "updated their info."
  const changes: string[] = [];
  const newPhone = (phone ?? resident.phone ?? "").toString().trim();
  const newEmail = (email ?? resident.email ?? "").toString().trim();
  const newEcName = (emergencyContactName ?? resident.emergency_contact_name ?? "").toString().trim();
  const newEcPhone = (emergencyContactPhone ?? resident.emergency_contact_phone ?? "").toString().trim();
  const newEcRelationship = (
    emergencyContactRelationship ?? resident.emergency_contact_relationship ?? ""
  ).toString().trim();

  if (newPhone !== (resident.phone || "")) changes.push(`phone to ${newPhone}`);
  if (newEmail !== (resident.email || "")) changes.push(`email to ${newEmail}`);
  if (newEcName !== (resident.emergency_contact_name || "")) changes.push(`emergency contact name to ${newEcName}`);
  if (newEcPhone !== (resident.emergency_contact_phone || "")) changes.push(`emergency contact phone to ${newEcPhone}`);
  if (newEcRelationship !== (resident.emergency_contact_relationship || ""))
    changes.push(`emergency contact relationship to ${newEcRelationship}`);

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      phone: newPhone,
      email: newEmail,
      emergency_contact_name: newEcName,
      emergency_contact_phone: newEcPhone,
      emergency_contact_relationship: newEcRelationship,
    })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (changes.length > 0) {
    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: residentId,
      resident_name: resident.full_name,
      update_type: "resident_info",
      message: `${resident.full_name} updated their ${changes.join(", ")}.`,
    });
  }

  return NextResponse.json({ success: true });
}
