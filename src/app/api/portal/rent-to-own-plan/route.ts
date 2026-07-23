import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/portal/rent-to-own-plan?residentId=...
// Read-only, resident-facing view of their own rent-to-own plan (if any).
// Uses the Service Role Key server-side since rv_lots/resident_invoices
// don't have anon-safe policies for this kind of cross-table read.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const { data: plan, error } = await supabaseAdmin
    .from("rent_to_own_plans")
    .select("id, lot_id, total_price, monthly_principal, status, started_at")
    .eq("resident_id", residentId)
    .is("deleted_at", null)
    .in("status", ["active", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!plan) {
    return NextResponse.json({ plan: null });
  }

  let lotName: string | null = null;
  if (plan.lot_id) {
    const { data: lot } = await supabaseAdmin
      .from("rv_lots")
      .select("lot_name")
      .eq("id", plan.lot_id)
      .maybeSingle();
    lotName = lot?.lot_name || null;
  }

  const { data: paidInvoices } = await supabaseAdmin
    .from("resident_invoices")
    .select("id")
    .eq("resident_id", residentId)
    .eq("status", "Paid");

  let paidSoFar = 0;
  const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
  if (invoiceIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from("resident_invoice_items")
      .select("amount")
      .in("invoice_id", invoiceIds)
      .eq("charge_type", "Rent-to-Own Principal");
    paidSoFar = (items || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);
  }

  return NextResponse.json({
    plan: {
      ...plan,
      lot_name: lotName,
      paid_so_far: paidSoFar,
      remaining: Math.max(0, Number(plan.total_price) - paidSoFar),
    },
  });
}
