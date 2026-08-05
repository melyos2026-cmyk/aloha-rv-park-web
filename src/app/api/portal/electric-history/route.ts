import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/electric-history?residentId=...
// Aug 5 (per Mely's full-site audit): /electric-history previously read
// resident_electric_readings directly with the anon key off a bare
// localStorage resident_id, with ZERO session verification — the same
// gap already fixed on Invoices/Payment History/Dashboard. A resident
// could edit their own localStorage value to view another resident's
// electric usage history.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("resident_electric_readings")
    .select("*")
    .eq("resident_id", residentId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ readings: data || [] });
}
