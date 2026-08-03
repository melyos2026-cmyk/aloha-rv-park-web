import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { generateInvoicePdf } from "@/lib/generate-invoice-pdf";

// GET /api/portal/invoice-pdf?invoiceId=...&residentId=...
export async function GET(req: NextRequest) {
  const invoiceId = req.nextUrl.searchParams.get("invoiceId");
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!invoiceId || !residentId) {
    return NextResponse.json({ error: "invoiceId and residentId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: invoice } = await supabase
    .from("resident_invoices")
    .select("id, resident_id, company_id, invoice_month, due_date, status, total_amount, created_at")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice || invoice.resident_id !== residentId) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, rv_lots(lot_name)")
    .eq("id", residentId)
    .maybeSingle();

  const { data: company } = await supabase
    .from("companies")
    .select("company_name, address, logo_url")
    .eq("id", invoice.company_id)
    .maybeSingle();

  const { data: items } = await supabase
    .from("resident_invoice_items")
    .select("description, amount")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  const pdfBuffer = await generateInvoicePdf({
    companyName: company?.company_name || "Park",
    companyAddress: company?.address || null,
    companyLogoUrl: company?.logo_url || null,
    residentName: resident?.full_name || "Resident",
    residentLot: (resident as any)?.rv_lots?.lot_name || null,
    invoiceMonth: invoice.invoice_month || "Invoice",
    issuedDate: invoice.created_at,
    dueDate: invoice.due_date,
    status: invoice.status,
    lineItems: (items || []).map((i) => ({
      description: i.description || "Charge",
      amount: Number(i.amount || 0),
    })),
    totalAmount: Number(invoice.total_amount || 0),
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${(invoice.invoice_month || "invoice").replace(/\s+/g, "-")}.pdf"`,
    },
  });
}
