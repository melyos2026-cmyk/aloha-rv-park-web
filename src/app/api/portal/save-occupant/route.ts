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
// Oct 19 (per Mely): SSNs go ONLY to the private applicant_ssn table (RLS
// on, no policies), never to resident_occupants. Replaced on each save.
async function saveOccupantSsn(companyId: string, residentId: string, occupantId: string, fullName: string, ssnDigits: string) {
  await supabase.from("applicant_ssn").delete().eq("occupant_id", String(occupantId));
  const { error } = await supabase.from("applicant_ssn").insert({
    company_id: companyId,
    resident_id: String(residentId),
    occupant_id: String(occupantId),
    person_role: "occupant",
    full_name: fullName,
    ssn: ssnDigits,
  });
  if (error) console.error("applicant_ssn insert (portal occupant) failed:", error.message);
}

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
    ssn,
  } = await req.json();

  // Oct 19 (per Mely): adult household members must give email + SSN.
  const ssnDigits = typeof ssn === "string" ? ssn.replace(/\D/g, "") : "";
  const dobDate = dateOfBirth ? new Date(dateOfBirth) : null;
  const age = dobDate && !isNaN(dobDate.getTime()) ? Math.floor((Date.now() - dobDate.getTime()) / 31557600000) : null;
  const isAdultHousehold = occupantType === "household" && age !== null && age >= 18;
  if (isAdultHousehold && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim())) {
    return NextResponse.json({ error: "A valid email is required for adults (18+)." }, { status: 400 });
  }
  if (isAdultHousehold && !occupantId && ssnDigits.length !== 9) {
    return NextResponse.json({ error: "A 9-digit Social Security number is required for adults (18+)." }, { status: 400 });
  }

  if (!residentId || !fullName || !fullName.trim()) {
    return NextResponse.json({ error: "residentId and fullName are required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
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

    if (isAdultHousehold && ssnDigits.length === 9) {
      await saveOccupantSsn(resident.company_id, residentId, occupantId, fullName.trim(), ssnDigits);
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

  const { data: inserted, error } = await supabase.from("resident_occupants").insert({
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
  }).select("id").single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (isAdultHousehold && ssnDigits.length === 9 && inserted?.id) {
    await saveOccupantSsn(resident.company_id, residentId, inserted.id, fullName.trim(), ssnDigits);
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
