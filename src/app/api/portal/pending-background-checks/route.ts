import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

const DONE_STATUSES = ["Passed", "in_progress", "invitation_sent", "Needs Review"];

// GET /api/portal/pending-background-checks?residentId=...
// Aug 4 (per Mely): powers the /residents/background-checks page — every
// Household Occupant who is 18+ (per date_of_birth) and doesn't already
// have a background check started/paid, plus the per-occupant fee (same
// figure used at original application time — park_settings.lease_defaults
// .application_fee_per_additional), so the resident can see the total
// before choosing how many to pay for in one Stripe charge.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { data: occupants, error } = await supabase
    .from("resident_occupants")
    .select("*")
    .eq("resident_id", residentId)
    .eq("occupant_type", "household");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pending = (occupants || []).filter((o) => {
    const age = calculateAge(o.date_of_birth);
    if (age === null || age < 18) return false;
    if (o.background_check_fee_paid) return false;
    if (DONE_STATUSES.includes(o.background_check_status)) return false;
    return true;
  });

  const { data: settings } = await supabase
    .from("park_settings")
    .select("lease_defaults")
    .eq("company_id", resident.company_id)
    .maybeSingle();

  const feeAmount = Number(settings?.lease_defaults?.application_fee_per_additional) || 0;

  return NextResponse.json({ pending, feeAmount });
}
