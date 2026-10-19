import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/submit-lease-application
// Body: { applicationId, invitationId, row }
// Aug 11 (per Mely — RLS hardening pass): resident_applications INSERT/
// UPDATE were open to the anon key with no real restriction. This is the
// one genuinely PUBLIC write in the whole app — a real applicant, with no
// admin session, submitting their own application — so unlike every other
// migration this session, it can't be gated behind an admin-session check.
// Moves the actual write server-side instead; the row-construction logic
// (all the field mapping/validation) stays exactly as it was in
// /apply/page.tsx, only the final insert/update call changed.
export async function POST(req: NextRequest) {
  const { applicationId, invitationId, row, ssnRecords } = await req.json();

  // Oct 19 (per Mely): defense in depth — whatever the client sends, an
  // SSN is never written into resident_applications itself.
  if (row && typeof row === "object") {
    delete (row as any).primary_applicant_ssn;
    if (row.form_draft_json && typeof row.form_draft_json === "object") {
      delete row.form_draft_json.primary_applicant_ssn;
      if (Array.isArray(row.form_draft_json.occupants)) {
        row.form_draft_json.occupants = row.form_draft_json.occupants.map((o: any) => {
          const { ssn, ...rest } = o || {};
          return rest;
        });
      }
    }
    if (Array.isArray(row.occupants)) {
      row.occupants = row.occupants.map((o: any) => {
        const { ssn, ...rest } = o || {};
        return rest;
      });
    }
  }

  if (!row || typeof row !== "object") {
    return NextResponse.json({ error: "row is required." }, { status: 400 });
  }

  if (invitationId) {
    // Sep 29 (per Mely — found live: an archived application got
    // resumed via get-application-draft and carried a real Stripe
    // payment + Checkr invitation through while still archived:true,
    // invisible in the admin Applications tab). get-application-draft
    // now refuses to hand back an archived row in the first place, but
    // this is a second, independent safety net: whatever the client
    // sends, a resumed/updated application is never left archived.
    const { error } = await supabaseAdmin
      .from("resident_applications")
      .update({ ...row, archived: false })
      .eq("id", invitationId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    if (!applicationId) {
      return NextResponse.json(
        { error: "applicationId is required for a new application." },
        { status: 400 }
      );
    }
    const { error } = await supabaseAdmin
      .from("resident_applications")
      .insert({ id: applicationId, ...row });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Oct 19 (per Mely — option B): Social Security numbers go ONLY into
  // the private applicant_ssn table (RLS enabled, no policies → only the
  // service role / Supabase dashboard can read it; the admin app never
  // selects from it). Replaced on every resubmit of the same application.
  const savedApplicationId = invitationId || applicationId;
  if (Array.isArray(ssnRecords) && ssnRecords.length > 0) {
    const clean = ssnRecords
      .map((r: any) => ({
        company_id: row.company_id || null,
        application_id: String(savedApplicationId),
        person_role: r?.person_role === "occupant" ? "occupant" : "primary",
        person_index: Number.isInteger(r?.person_index) ? r.person_index : null,
        full_name: String(r?.full_name || "").trim(),
        ssn: String(r?.ssn || "").replace(/\D/g, ""),
      }))
      .filter((r: any) => r.ssn.length === 9);
    if (clean.length > 0) {
      await supabaseAdmin.from("applicant_ssn").delete().eq("application_id", String(savedApplicationId));
      const { error: ssnError } = await supabaseAdmin.from("applicant_ssn").insert(clean);
      if (ssnError) {
        // The application itself is saved; don't block the applicant
        // from paying over this, but make it visible in the logs.
        console.error("applicant_ssn insert failed:", ssnError.message);
      }
    }
  }

  return NextResponse.json({ success: true });
}
