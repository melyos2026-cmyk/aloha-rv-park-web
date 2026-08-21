import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/get-lot-blocked-ranges?lotId=...
// Aug 21 (per Mely — found live testing: "en https://aloharvparkfl.com/apply
// todavia esta corriendo todos los dias y esto puedo causar double
// booking"): lotAvailability.ts called get_lot_blocked_ranges directly
// from the browser with the anon key. That function has no SECURITY
// DEFINER, so it runs with the CALLER's permissions — and lot_orders /
// resident_leases (2 of the 4 sources it reads) have RLS enabled with
// ZERO policies, meaning those rows were ALWAYS silently invisible to
// the public /apply form. The map's own equivalent (aloha-rv-park's
// /api/lot-data?type=availability) already runs this same RPC through a
// server route with Service Role, which is why the map correctly
// blocked these same dates while /apply showed everything as open —
// a real double-booking risk this whole time, not just a display bug.
export async function GET(req: NextRequest) {
  const lotId = req.nextUrl.searchParams.get("lotId");
  if (!lotId) {
    return NextResponse.json({ error: "lotId is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("get_lot_blocked_ranges", { p_lot_id: lotId });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
