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
  const { applicationId, invitationId, row } = await req.json();

  if (!row || typeof row !== "object") {
    return NextResponse.json({ error: "row is required." }, { status: 400 });
  }

  if (invitationId) {
    const { error } = await supabaseAdmin
      .from("resident_applications")
      .update(row)
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

  return NextResponse.json({ success: true });
}
