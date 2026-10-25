import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { startInvoicePayment, startMultiInvoicePayment, MAX_INVOICES_PER_PAYMENT } from "@/lib/marina/checkout";

// POST /api/marina/pay  { invoice_id }
// Pays the remaining balance of ONE of the signed-in boater's own invoices.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const session = await getMarinaSession(req);
  if (!session || session.companyId !== company.id) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let invoiceId = ""; let method: "card" | "ach" = "card"; let many: string[] = [];
  try {
    const b = await req.json();
    invoiceId = String(b.invoice_id || "");
    if (b.method === "ach") method = "ach";   // Oct 24: bank transfer
    if (Array.isArray(b.invoice_ids)) many = b.invoice_ids.map((x: any) => String(x || "")).filter(Boolean).slice(0, 50);
  } catch {}
  const origin = `https://${company.domain}`;

  // Oct 24 (per Mely): "Pay balance" — several of the boater's own invoices in one payment.
  if (many.length) {
    if (many.length > MAX_INVOICES_PER_PAYMENT) return NextResponse.json({ error: `You can pay up to ${MAX_INVOICES_PER_PAYMENT} invoices at once. Please uncheck some.` }, { status: 400 });
    const { data: mine } = await supabaseAdmin.from("marina_invoices").select("id").eq("company_id", company.id).eq("member_id", session.memberId).in("id", many);
    if ((mine || []).length !== new Set(many).size) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    const r = await startMultiInvoicePayment({ company, invoiceIds: many, memberId: session.memberId, method, successUrl: `${origin}/marina/account?paid=success`, cancelUrl: `${origin}/marina/account?paid=cancelled` });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json("url" in r ? { url: r.url } : { ok: true, demo: true });
  }
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice." }, { status: 400 });

  // The invoice must belong to this boater AND this marina.
  const { data: owned } = await supabaseAdmin
    .from("marina_invoices")
    .select("id")
    .eq("id", invoiceId)
    .eq("company_id", company.id)
    .eq("member_id", session.memberId)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const result = await startInvoicePayment({
    company,
    invoiceId,
    memberId: session.memberId,
    method,
    successUrl: `${origin}/marina/account?paid=success`,
    cancelUrl: `${origin}/marina/account?paid=cancelled`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json("url" in result ? { url: result.url } : { ok: true, demo: true });
}
