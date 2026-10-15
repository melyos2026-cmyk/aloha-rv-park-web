import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { round2, todayET } from "./data";

// Writes an online card payment against a marina invoice. Online payments
// have no employee and no cash-drawer shift, so shift_id stays empty and the
// row is labelled "Online payment" (the staff screens already show it).
// `reference` is unique per Stripe session, so a repeated webhook delivery is
// harmless: the second insert is refused by the database and treated as done.
export async function recordMarinaOnlinePayment(p: {
  companyId: string;
  invoiceId: string;
  amount: number;
  reference: string;
  demo?: boolean;
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const { data: invoice } = await supabaseAdmin
    .from("marina_invoices")
    .select("id, amount, status")
    .eq("id", p.invoiceId)
    .eq("company_id", p.companyId)
    .maybeSingle();
  if (!invoice) return { ok: false, error: "Invoice not found." };
  if (invoice.status === "void") return { ok: false, error: "This invoice was cancelled." };

  const { error } = await supabaseAdmin.from("marina_invoice_payments").insert({
    company_id: p.companyId,
    invoice_id: p.invoiceId,
    amount: round2(p.amount),
    method: "card",
    reference: p.reference,
    received_at: todayET(),
    recorded_by_name: p.demo ? "Online payment (demo)" : "Online payment",
    shift_id: null,
  });

  if (error) {
    if (error.code === "23505") return { ok: true, duplicate: true };
    await logSystemHealthIssue({
      companyId: p.companyId,
      issueType: "marina_online_payment_failed",
      source: "stripe",
      message: `A marina online payment (${p.reference}) could not be recorded: ${error.message}`,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
