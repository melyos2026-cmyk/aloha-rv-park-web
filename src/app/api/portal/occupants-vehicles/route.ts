import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/occupants-vehicles?residentId=...
// FOUND THE ROOT CAUSE (Aug 3): resident_occupants and resident_vehicles
// both have a deny-all RLS policy (RLS enabled, zero policies — confirmed
// in the Jul 21 RLS sweep). Saving already worked fine after the session
// migration (uses the Service Role Key, which bypasses RLS) — confirmed
// live via the browser's Network tab showing {"success":true} — but
// residents/dashboard/page.tsx's loadResidentDashboard() was still
// reading these two tables directly with the anon key client-side, which
// RLS silently blocks (Supabase returns zero rows, not an error), making
// a successful save look like it never happened.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: occupants, error: occError } = await supabase
    .from("resident_occupants")
    .select("*")
    .eq("resident_id", residentId);

  if (occError) {
    return NextResponse.json({ error: occError.message }, { status: 500 });
  }

  // Aug 4 (per Mely): tells the dashboard whether each Household Occupant
  // already has an ID uploaded, so it can show "Upload ID" first and only
  // reveal "Proceed with Background Check" once that's actually done —
  // showing both at the same time confused residents into thinking they
  // could skip straight to paying.
  const occupantIds = (occupants || []).map((o) => o.id);
  let occupantsWithIdFlag = occupants || [];
  if (occupantIds.length > 0) {
    const { data: idDocs } = await supabase
      .from("resident_documents")
      .select("related_occupant_id")
      .in("related_occupant_id", occupantIds);
    const idsWithDocs = new Set((idDocs || []).map((d) => d.related_occupant_id));
    occupantsWithIdFlag = (occupants || []).map((o) => ({
      ...o,
      has_id_uploaded: idsWithDocs.has(o.id),
    }));
  }

  const { data: vehicles, error: vehError } = await supabase
    .from("resident_vehicles")
    .select("*")
    .eq("resident_id", residentId);

  if (vehError) {
    return NextResponse.json({ error: vehError.message }, { status: 500 });
  }

  return NextResponse.json({ occupants: occupantsWithIdFlag, vehicles: vehicles || [] });
}
