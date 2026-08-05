import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/active-lease?residentId=...
// Aug 5 (per Mely: the Moving Out card never showed up): this read used
// the anon key directly with zero session check — same class of bug
// fixed on several other screens today, where resident_leases (or a
// related table) silently returns nothing under RLS instead of erroring,
// making `activeLease` always null regardless of whether a real active
// lease exists.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: lease, error } = await supabase
    .from("resident_leases")
    .select("id, requested_move_out_date, requested_move_out_note")
    .eq("resident_id", residentId)
    .eq("status", "Active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lease: lease || null });
}
