import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { MarinaCompany } from "./company";
import { startInvoicePayment, type StartPaymentResult } from "./checkout";
import { round2, todayET } from "./data";

// Oct 24 (per Mely — "everything has to be paid before"): concierge requests paid online up front.
// Creates the request's invoice once (due today) and starts the card / demo payment.
// When the payment is recorded, conciergePaid.ts confirms an approved quote and tells the office.
export async function startConciergePayment(company: MarinaCompany, r: any, memberId: string | null): Promise<StartPaymentResult> {
  let invoiceId: string | null = r.invoice_id || null;
  const total = round2(Number(r.total || 0));
  if (total <= 0) return { ok: false, status: 400, error: "This request has no price yet." };
  if (!invoiceId) {
    const today = todayET();
    const when = new Date(r.wanted_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    for (let i = 0; i < 5 && !invoiceId; i++) {
      const { data, error } = await supabaseAdmin.from("marina_invoices").insert({
        company_id: company.id, invoice_number: `WEB-${today.replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
        category: "other", member_id: memberId, customer_name: r.customer_name, customer_email: r.customer_email,
        description: `Concierge ${r.request_number}: ${r.service_name || "request"}${r.units > 1 ? ` × ${r.units}` : ""} · ${when}${r.slip_name ? ` · slip ${r.slip_name}` : ""}`.slice(0, 300),
        amount: total, issue_date: today, due_date: today,
      }).select("id").single();
      if (data) invoiceId = data.id;
      else if (error?.code !== "23505") return { ok: false, status: 500, error: "Could not start the payment. Please try again." };
    }
    if (!invoiceId) return { ok: false, status: 500, error: "Could not start the payment. Please try again." };
    // Link it only if no other tap linked one first (double-click / two tabs) — never two invoices.
    const { data: linked } = await supabaseAdmin.from("concierge_requests").update({ invoice_id: invoiceId, payment: "card", updated_at: new Date().toISOString() })
      .eq("id", r.id).eq("company_id", company.id).is("invoice_id", null).select("id");
    if (!linked?.length) {
      await voidUnpaidInvoice(company.id, invoiceId, `Duplicate payment start for ${r.request_number}`);
      const { data: cur } = await supabaseAdmin.from("concierge_requests").select("invoice_id").eq("id", r.id).eq("company_id", company.id).maybeSingle();
      invoiceId = cur?.invoice_id || null;
      if (!invoiceId) return { ok: false, status: 409, error: "Please try again." };
    }
  }
  const origin = `https://${company.domain}`;
  return startInvoicePayment({
    company, invoiceId, memberId,
    successUrl: `${origin}/marina/concierge?request=${encodeURIComponent(r.request_number)}&paid=1`,
    cancelUrl: `${origin}/marina/concierge?request=${encodeURIComponent(r.request_number)}&paid=0`,
  });
}

// Voids a concierge invoice only while nothing has been paid on it (declined / payment never started).
export async function voidUnpaidInvoice(companyId: string, invoiceId: string | null | undefined, reason: string) {
  if (!invoiceId) return;
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("amount, returned_at").eq("company_id", companyId).eq("invoice_id", invoiceId);
  if ((pays || []).some((p: any) => !p.returned_at && Number(p.amount) > 0)) return;
  await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: reason.slice(0, 300) })
    .eq("id", invoiceId).eq("company_id", companyId).eq("status", "open");
}
