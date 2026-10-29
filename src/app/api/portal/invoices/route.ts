import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { invoicesPreparing, invoiceGenerateDayForResident, moveInInvoiceIds } from "@/lib/invoiceRentReady";

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
  // Oct 29: preparing_message says why (e.g. next month's electric reading isn't on it yet).
  const preparing = await invoicesPreparing(residentId, data || []);
  // Oct 29 (review): the move-in invoice is owed now — the portal never shows it as "Pay ahead".
  const moveIn = await moveInInvoiceIds(residentId, (data || []).filter((i) => i.status === "Pending"));
  return NextResponse.json({
    invoiceGenerateDay: await invoiceGenerateDayForResident(residentId),
    invoices: (data || []).map((inv) => {
      const p = preparing.get(inv.id);
      const row = moveIn.has(inv.id) ? { ...inv, is_move_in: true } : inv;
      return p ? { ...row, preparing_until: p.until, preparing_reason: p.reason, preparing_message: p.message } : row;
    }),
  });
}
