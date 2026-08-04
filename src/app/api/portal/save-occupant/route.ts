import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-occupant
// Body: { residentId, occupantId?, occupantType, fullName, relationship,
//         phone, email, stayStart, stayEnd, dateOfBirth }
// Replaces the previous direct client-side Supabase inserts/updates to
// resident_occupants in residents/dashboard/page.tsx (addOccupant), which
// were protected only by RLS (if any) rather than by the real session
// check + ownership check added below. Behavior (which fields get saved,
// which notification fires) is unchanged from the original client code.
export async function POST(req: NextRequest) {
  const {
    residentId,
    occupantId,
    occupantType,
    fullName,
    relationship,
    phone,
    email,
    stayStart,
    stayEnd,
    dateOfBirth,
  } = await req.json();

  if (!residentId || !fullName || !fullName.trim()) {
    return NextResponse.json({ error: "residentId and fullName are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  if (occupantId) {
    // SECURITY: confirm this occupant actually belongs to the session's own
    // resident before letting them edit it — otherwise anyone could edit a
    // different resident's household member/visitor just by knowing/
    // guessing the occupant's id.
    const { data: existing } = await supabase
      .from("resident_occupants")
      .select("id, resident_id")
      .eq("id", occupantId)
      .maybeSingle();

    if (!existing || existing.resident_id !== residentId) {
      return NextResponse.json({ error: "Occupant not found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("resident_occupants")
      .update({
        full_name: fullName.trim(),
        relationship: (relationship || "").trim(),
        phone: (phone || "").trim(),
        email: (email || "").trim().toLowerCase(),
        stay_start_date: stayStart || null,
        stay_end_date: stayEnd || null,
        ...(dateOfBirth !== undefined ? { date_of_birth: dateOfBirth || null } : {}),
      })
      .eq("id", occupantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: residentId,
      resident_name: resident.full_name,
      update_type: "visitor_updated",
      message: `${resident.full_name} updated a visitor: ${fullName.trim()}.`,
    });

    return NextResponse.json({ success: true });
  }

  const { error } = await supabase.from("resident_occupants").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    occupant_type: occupantType,
    full_name: fullName.trim(),
    relationship: (relationship || "").trim(),
    phone: (phone || "").trim(),
    email: (email || "").trim().toLowerCase(),
    stay_start_date: occupantType === "visitor" ? stayStart || null : null,
    stay_end_date: occupantType === "visitor" ? stayEnd || null : null,
    date_of_birth: occupantType === "household" ? dateOfBirth || null : null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    resident_name: resident.full_name,
    update_type: occupantType === "visitor" ? "visitor_added" : "occupant_added",
    message: `${resident.full_name} added a new ${
      occupantType === "visitor" ? "visitor" : "household occupant"
    }: ${fullName.trim()}.`,
  });

  return NextResponse.json({ success: true });
}
