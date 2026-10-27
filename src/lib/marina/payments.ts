import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { Resend } from "resend";
import { round2, todayET } from "./data";
import { isDemoCompany } from "./host";
import { confirmStoreOrderForInvoice } from "./storeOrders";
import { conciergePaidForInvoice } from "./conciergePaid";
import { rentalPaidForInvoice } from "./rentalPaid";
import { slipRequestPaidForInvoice } from "./slipRequests";
import { createBalanceInvoice } from "./booking";

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
    .select("*");
  const r: any = rows?.[0];
  if (!r) return;
  // Oct 26 (per Mely): paid with a deposit → the balance becomes its own invoice.
  await createBalanceInvoice(companyId, r).catch(() => null);
  const partial = Number(r.deposit_amount) > 0 && Number(r.deposit_amount) < Number(r.amount);
  const [{ data: company }, { data: slip }] = await Promise.all([
    supabaseAdmin.from("companies").select("company_name, domain, contact_phone, is_demo").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).maybeSingle(),
  ]);
  if (!company || isDemoCompany(company as any) || !r.guest_email) return;
  try {
    await resend.emails.send({
      from: `${company.company_name} <noreply@aloharvparkfl.com>`,
      to: r.guest_email,
      subject: `Your slip reservation at ${company.company_name} is confirmed`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 8px;">Reservation confirmed</h2>
        <p style="color:#444;">Hi ${esc(r.guest_name)}, your payment was received.</p>
        <p style="color:#444;line-height:1.7;"><b>Slip:</b> ${esc(slip?.slip_name || "")}${slip?.dock ? ` (${esc(slip.dock)})` : ""}<br/>
        <b>Arrive:</b> ${esc(r.start_date)}<br/><b>Depart:</b> ${esc(r.end_date)}<br/>${partial ? `<b>Deposit paid:</b> $${Number(r.deposit_amount).toFixed(2)}<br/><b>Balance:</b> $${(Number(r.amount) - Number(r.deposit_amount)).toFixed(2)} due ${esc(String(r.balance_due_date || r.start_date))}` : `<b>Paid:</b> $${Number(r.amount).toFixed(2)}`}</p>
        ${r.access_token && company.domain ? `<p><a href="https://${company.domain}/marina/reservation/${r.id}?t=${r.access_token}" style="display:inline-block;background:#0f2540;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${partial ? "See my booking and pay the balance" : "See my booking"}</a></p>` : ""}
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
  method?: "card" | "ach";
  pending?: boolean;   // Oct 24: a bank transfer that has not cleared yet
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const { data: invoice } = await supabaseAdmin
    .from("marina_invoices")
    .select("id, amount, status")
    .eq("id", p.invoiceId)
    .eq("company_id", p.companyId)
    .maybeSingle();
  // Oct 24: money taken by Stripe but not recordable must never be silent — flag it for a refund.
  if (!invoice || invoice.status === "void") {
    if (!p.demo) await logSystemHealthIssue({
      companyId: p.companyId, issueType: "marina_online_payment_failed", source: "stripe",
      message: `Online payment ${p.reference} of $${round2(p.amount).toFixed(2)} was received for an invoice that is ${invoice ? "cancelled (void)" : "missing"}. Refund it from Stripe or apply it by hand.`,
    }).catch(() => null);
    return { ok: false, error: invoice ? "This invoice was cancelled." : "Invoice not found." };
  }
  // Oct 24: paying an invoice that was already paid (e.g. "Pay balance" + a separate payment): record
  // it (the money was taken) and flag the overpayment so the office refunds it.
  {
    const { data: prior } = await supabaseAdmin.from("marina_invoice_payments").select("amount, returned_at, reference").eq("company_id", p.companyId).eq("invoice_id", invoice.id);
    const already = (prior || []).filter((x: any) => !x.returned_at && x.reference !== p.reference).reduce((a: number, x: any) => a + Number(x.amount), 0);
    if (!p.demo && already > 0 && already + p.amount > Number(invoice.amount) + 0.005) {
      await logSystemHealthIssue({
        companyId: p.companyId, issueType: "marina_online_overpayment", source: "stripe",
        message: `Invoice ${invoice.id} was paid more than once: $${round2(already + p.amount).toFixed(2)} received for $${Number(invoice.amount).toFixed(2)} (latest ${p.reference}). Refund the extra.`,
      }).catch(() => null);
    }
  }

  const { error } = await supabaseAdmin.from("marina_invoice_payments").insert({
    company_id: p.companyId,
    invoice_id: p.invoiceId,
    amount: round2(p.amount),
    method: p.method === "ach" ? "ach" : "card",
    reference: p.reference,
    received_at: todayET(),
    recorded_by_name: p.demo ? "Online payment (demo)" : p.method === "ach" ? (p.pending ? "Online bank transfer (pending)" : "Online bank transfer") : "Online payment",
    shift_id: null,
    ...(p.pending ? { pending_at: new Date().toISOString() } : {}),
  });

  // A pending bank transfer does not confirm a reservation yet; the settle call below does.
  if ((!error || error.code === "23505") && !p.pending) {
    await confirmReservationForInvoice(p.companyId, p.invoiceId);
    await confirmStoreOrderForInvoice(p.companyId, p.invoiceId); // Oct 24: store order confirmation email
    await conciergePaidForInvoice(p.companyId, p.invoiceId);     // Oct 24: concierge paid up front
    await rentalPaidForInvoice(p.companyId, p.invoiceId);        // Oct 24: rental booking paid
    await slipRequestPaidForInvoice(p.companyId, p.invoiceId);   // Oct 26: slip request deposit
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

// Oct 24: the bank confirmed an ACH payment that was recorded as pending.
export async function settleMarinaAchPayment(companyId: string, reference: string) {
  // Oct 24: one bank payment can cover several invoices ("Pay balance": references "<ref>:1", "<ref>:2"…).
  const { data } = await supabaseAdmin.from("marina_invoice_payments")
    .update({ pending_at: null, recorded_by_name: "Online bank transfer" })
    .eq("company_id", companyId).or(`reference.eq.${reference},reference.like.${reference}:%`).not("pending_at", "is", null)
    .select("invoice_id");
  for (const row of data || []) {
    const inv = row.invoice_id;
    await confirmReservationForInvoice(companyId, inv); await confirmStoreOrderForInvoice(companyId, inv); await conciergePaidForInvoice(companyId, inv); await rentalPaidForInvoice(companyId, inv); await slipRequestPaidForInvoice(companyId, inv);
  }
}

// Oct 24: the bank rejected an ACH payment (insufficient funds, closed account…). The payment is
// marked returned, so the invoice goes back to open — the same as a bounced check.
export async function failMarinaAchPayment(companyId: string, reference: string, reason: string) {
  await supabaseAdmin.from("marina_invoice_payments")
    .update({ pending_at: null, returned_at: new Date().toISOString(), return_reason: `Bank payment failed: ${reason}`.slice(0, 300), recorded_by_name: "Online bank transfer (failed)" })
    .eq("company_id", companyId).or(`reference.eq.${reference},reference.like.${reference}:%`).is("returned_at", null);
}

// Oct 24 (per Mely — security run): money given back in Stripe (full refund, or a lost dispute)
// reopens the marina invoice(s) it paid, so the books never show "paid" for money that left.
// Covers single payments ("online:<session>") and Pay balance ("online:<session>:N").
export async function returnMarinaOnlinePayment(companyId: string, sessionId: string, reason: string) {
  const ref = `online:${sessionId}`;
  const { data } = await supabaseAdmin.from("marina_invoice_payments")
    .update({ returned_at: new Date().toISOString(), return_reason: reason.slice(0, 300), recorded_by_name: "Online payment (returned)" })
    .eq("company_id", companyId).or(`reference.eq.${ref},reference.like.${ref}:%`).is("returned_at", null)
    .select("invoice_id, amount");
  if (data?.length) {
    await logSystemHealthIssue({
      companyId, issueType: "marina_online_payment_returned", source: "stripe",
      message: `${reason}: $${data.reduce((a: number, r: any) => a + Number(r.amount || 0), 0).toFixed(2)} on ${data.length} marina invoice(s) was marked returned; the invoice(s) are open again.`,
    }).catch(() => null);
  }
}

// Oct 26: money given back (refund or lost dispute) on payments recorded under a reference
// ("autopay:<pi>" and "autopay:<pi>:N"). The invoices reopen; autopay never charges an invoice
// that had money returned (see dueForAutopay), so a refund is not charged again.
export async function returnMarinaPaymentRef(companyId: string, reference: string, reason: string) {
  await supabaseAdmin.from("marina_invoice_payments")
    .update({ returned_at: new Date().toISOString(), return_reason: reason.slice(0, 300), recorded_by_name: "Online payment (returned)", pending_at: null })
    .eq("company_id", companyId).or(`reference.eq.${reference},reference.like.${reference}:%`).is("returned_at", null);
}

// Oct 27 (per Mely — "un hold como hacen los hoteles"): the guest's card is authorized for the
// regular price while the office checks their proof of residency. The booking is confirmed now;
// approved → the resident price is charged and the rest released; not approved (or no answer in
// 6 days, before the card hold expires) → the regular price is charged. See the admin app
// lib/marinaHolds.ts. Safe to call twice.
export async function cardHoldPlaced(companyId: string, invoiceId: string, pi: string, sessionId: string, held: number, feePassed: boolean) {
  const { data: rows } = await supabaseAdmin.from("marina_reservations")
    .update({ status: "confirmed", hold_pi: pi, hold_session: sessionId, hold_amount: held, hold_placed_at: new Date().toISOString(), hold_fee_passed: feePassed })
    .eq("company_id", companyId).eq("invoice_id", invoiceId).eq("status", "pending").select("*");
  const r: any = rows?.[0];
  if (!r) return;
  const [{ data: company }, { data: slip }] = await Promise.all([
    supabaseAdmin.from("companies").select("company_name, domain, contact_phone, is_demo").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).maybeSingle(),
  ]);
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: companyId, resident_name: r.guest_name, update_type: "document", message: `${r.guest_name} booked slip ${slip?.slip_name || ""} with a card hold while their proof of residency is checked. Approve or refuse it in Document Review → Residency.` }).then(() => null, () => null);
  if (!company || isDemoCompany(company as any) || !r.guest_email) return;
  try {
    await resend.emails.send({
      from: `${company.company_name} <noreply@aloharvparkfl.com>`,
      to: r.guest_email,
      subject: `Your slip reservation at ${company.company_name} is confirmed`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 8px;">Reservation confirmed</h2>
        <p style="color:#444;">Hi ${esc(r.guest_name)}, your slip is booked.</p>
        <p style="color:#444;line-height:1.7;"><b>Slip:</b> ${esc(slip?.slip_name || "")}${slip?.dock ? ` (${esc(slip.dock)})` : ""}<br/><b>Arrive:</b> ${esc(r.start_date)}<br/><b>Depart:</b> ${esc(r.end_date)}</p>
        <p style="color:#444;">We placed a <b>hold of $${Number(held).toFixed(2)}</b> on your card (not a charge). When the office confirms your residency, we charge the resident price${r.resident_amount ? ` ($${Number(r.resident_amount).toFixed(2)})` : ""} and release the rest. If it can't be confirmed, the regular price is charged.</p>
        ${r.access_token && company.domain ? `<p><a href="https://${company.domain}/marina/reservation/${r.id}?t=${r.access_token}" style="display:inline-block;background:#0f2540;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">See my booking</a></p>` : ""}
        <p style="color:#666;font-size:13px;">${company.contact_phone ? `Questions? Call ${esc(company.contact_phone)}.` : ""}</p>
      </div>`,
    });
  } catch (err: any) { console.error("hold email failed:", err?.message); }
}
