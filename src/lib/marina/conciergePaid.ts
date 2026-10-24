import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 24 (per Mely): a concierge request's invoice was paid online. An approved quote becomes
// confirmed; the office is told it's paid so it can go ahead. Safe to call more than once.
export async function conciergePaidForInvoice(companyId: string, invoiceId: string) {
  const { data: r, error } = await supabaseAdmin.from("concierge_requests").select("id, request_number, status, total, customer_name")
    .eq("company_id", companyId).eq("invoice_id", invoiceId).maybeSingle();
  if (error || !r) return;
  if (r.status === "quoted") {
    await supabaseAdmin.from("concierge_requests").update({ status: "confirmed", status_by_name: "Customer (paid)", updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "quoted");
  }
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: companyId, resident_name: r.customer_name, update_type: "concierge_request",
    message: `Request ${r.request_number} was paid online ($${Number(r.total || 0).toFixed(2)})${r.status === "quoted" ? " — quote approved, go ahead" : ""}.`,
  }).then(() => null, () => null);
}
