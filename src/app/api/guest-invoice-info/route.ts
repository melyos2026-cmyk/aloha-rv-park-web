import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { invoicesPreparing, invoiceGenerateDayForResident, moveInInvoiceIds } from "@/lib/invoiceRentReady";

// GET /api/guest-invoice-info?token=xxx
// Aug 5 (per Mely): deliberately minimal — only what's needed for a
// non-resident to confirm they're paying the right amount, never the
// resident's name, email, or itemized charges. Looked up by the random
// guest_payment_token only, never by the invoice's real ID.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  const { data: invoice, error } = await supabase
    .from("resident_invoices")
    .select("id, resident_id, total_amount, due_date, status, invoice_month")
    .eq("guest_payment_token", token)
    .maybeSingle();

  if (error || !invoice) {
    return NextResponse.json({ error: "Payment link not found or expired." }, { status: 404 });
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("space_id")
    .eq("id", invoice.resident_id)
    .maybeSingle();

  let lotName: string | null = null;
  if (resident?.space_id) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("lot_name")
      .eq("id", resident.space_id)
      .maybeSingle();
    lotName = lot?.lot_name || null;
  }

  // Oct 28 (review): this month's invoice still waiting for rent isn't payable yet.
  const preparing = (await invoicesPreparing(invoice.resident_id, [invoice])).get(invoice.id) || null;

  return NextResponse.json({
    preparingUntil: preparing?.until || null,
    preparingMessage: preparing?.message || null,
    invoiceGenerateDay: await invoiceGenerateDayForResident(invoice.resident_id),
    isMoveIn: (await moveInInvoiceIds(invoice.resident_id, [invoice])).has(invoice.id),
    lotName,
    invoiceMonth: invoice.invoice_month,
    amountDue: Number(invoice.total_amount || 0),
    dueDate: invoice.due_date,
    status: invoice.status,
  });
}
