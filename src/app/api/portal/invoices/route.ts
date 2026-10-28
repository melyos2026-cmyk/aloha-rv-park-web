import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { invoicesAwaitingRent } from "@/lib/invoiceRentReady";

// GET /api/portal/invoices?residentId=...
// SECURITY (Aug 3, found while building #17): this page previously read
// resident_invoices directly with the anon key off a bare localStorage
// resident_id, no session check — same gap as payment-history had.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("resident_invoices")
    .select("*")
    .eq("resident_id", residentId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Oct 28 (review): this month's invoice that is still waiting for rent ("being prepared") carries
  // the day it becomes payable, so the portal shows it without a Pay button.
  const awaitingRent = await invoicesAwaitingRent(residentId, data || []);
  return NextResponse.json({
    invoices: (data || []).map((inv) => (awaitingRent.has(inv.id) ? { ...inv, preparing_until: awaitingRent.get(inv.id) } : inv)),
  });
}
