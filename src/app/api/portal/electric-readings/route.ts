import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/electric-readings?residentId=...
// Aug 11: last remaining direct client-side (anon-key) Supabase read in
// residents/dashboard/page.tsx, found while closing out the Aug 2/4
// session-auth migration. Everything else in this file already goes
// through a session-guarded /api/portal/* route (occupants, vehicles,
// invoices, resident info, etc.) — this one was missed, meaning a
// resident's electric usage history could be read by anyone who could
// swap the residentId, without proving they own that session. Same fix
// pattern as occupants-vehicles: move the read server-side behind
// requireMatchingSession.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: readings, error } = await supabase
    .from("resident_electric_readings")
    .select("*")
    .eq("resident_id", residentId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ readings: readings || [] });
}
