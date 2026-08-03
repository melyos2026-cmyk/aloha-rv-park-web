import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/invoice-items?invoiceId=...&residentId=...
export async function GET(req: NextRequest) {
  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!invoiceId || !residentId) {
    return NextResponse.json({ error: "invoiceId and residentId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  // Confirm this invoice actually belongs to the session's own resident
  // before returning its items.
  const { data: invoice } = await supabase
    .from("resident_invoices")
    .select("id, resident_id")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice || invoice.resident_id !== residentId) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("resident_invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}
