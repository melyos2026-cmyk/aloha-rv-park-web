import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/resident-profile?residentId=...
//
// Aug 7 (per Mely, CRITICAL real gap found): residents/dashboard/page.tsx
// queried resident_accounts DIRECTLY from the browser with the anon key,
// trusting a residentId read from localStorage. resident_accounts' anon
// SELECT policy is `portal_enabled = true AND deleted_at IS NULL` — with
// NO id-scoping at all — meaning ANY unauthenticated client could read
// EVERY resident's full profile across EVERY company with portal access
// enabled, no login or guessing required. Same server-route-with-session-
// check fix used everywhere else this class of bug has been hit in this
// project, matching the active-lease route's pattern exactly.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error } = await supabase
    .from("resident_accounts")
    .select("*, rv_lots(lot_name), companies(company_name)")
    .eq("id", residentId)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ resident });
}
