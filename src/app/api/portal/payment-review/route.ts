import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getPortalSession } from "@/lib/portalSession";

// GET /api/portal/payment-review?ids=id1,id2,id3
//
// Aug 19 (per Mely — module-by-module audit): payment-review/page.tsx
// read resident_payments directly with the anon key off a set of IDs
// stored in localStorage, with zero session verification — the exact
// same gap already fixed on payment-history and occupants/vehicles.
// (Note: nothing in this codebase currently writes selected_payment_ids
// to localStorage, so this code path is dead today — fixed anyway so it
// doesn't become a live gap the moment someone wires that flow back up.)
// Derives the resident purely from the signed session cookie — never
// trusts a client-supplied residentId at all, so there's no id to swap.
export async function GET(req: NextRequest) {
  const session = getPortalSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json({ error: "ids is required." }, { status: 400 });
  }

  const ids = idsParam.split(",").filter(Boolean);

  const { data, error } = await supabase
    .from("resident_payments")
    .select("*")
    .in("id", ids)
    .eq("resident_id", session.residentId)
    .eq("status", "Pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payments: data || [] });
}
