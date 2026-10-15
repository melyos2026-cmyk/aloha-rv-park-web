import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { Resend } from "resend";
import { round2, todayET } from "./data";
import { isDemoDomain } from "./host";

const resend = new Resend(process.env.RESEND_API_KEY);
const esc = (v: string) => v.replace(/[<>&"]/g, "");

// A paid web reservation becomes confirmed, and (for real marinas) the guest gets an email.
// Safe to call twice: only a still-pending reservation is changed.
async function confirmReservationForInvoice(companyId: string, invoiceId: string) {
  const { data: rows } = await supabaseAdmin
    .from("marina_reservations")
    .update({ status: "confirmed" })
    .eq("company_id", companyId)
    .eq("invoice_id", invoiceId)
    .eq("status", "pending")
    .select("guest_name, guest_email, start_date, end_date, amount, slip_id");
  const r = rows?.[0];
  if (!r) return;
  const [{ data: company }, { data: slip }] = await Promise.all([
    supabaseAdmin.from("companies").select("company_name, domain, contact_phone").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).maybeSingle(),
  ]);
  if (!company || isDemoDomain(company.domain) || !r.guest_email) return;
  try {
    await resend.emails.send({
      from: `${company.company_name} <noreply@aloharvparkfl.com>`,
      to: r.guest_email,
      subject: `Your slip reservation at ${company.company_name} is confirmed`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 8px;">Reservation confirmed</h2>
        <p style="color:#444;">Hi ${esc(r.guest_name)}, your payment was received.</p>
        <p style="color:#444;line-height:1.7;"><b>Slip:</b> ${esc(slip?.slip_name || "")}${slip?.dock ? ` (${esc(slip.dock)})` : ""}<br/>
        <b>Arrive:</b> ${esc(r.start_date)}<br/><b>Depart:</b> ${esc(r.end_date)}<br/><b>Paid:</b> $${Number(r.amount).toFixed(2)}</p>
        <p style="color:#666;font-size:13px;">${company.contact_phone ? `Questions? Call ${esc(company.contact_phone)}.` : ""}</p>
      </div>`,
    });
  } catch (err: any) {
    console.error("marina reservation email failed:", err?.message);
  }
}

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

  if (!error || error.code === "23505") {
    await confirmReservationForInvoice(p.companyId, p.invoiceId);
  }
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
