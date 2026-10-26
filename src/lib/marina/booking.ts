import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { round2, todayET } from "./data";

// Oct 26 (per Mely — "lo que nos hace falta"): how an online booking is paid. The marina chooses
// in Reservations → Booking settings: the full stay now, or a deposit now (a percent or the first
// night) and the balance on arrival or some days before. Shared by the booking API, the booking
// page and the payment hook.

export type BookingSettings = { deposit_mode: "full" | "percent" | "first_night"; deposit_percent: number; balance_due: "arrival" | "days_before"; balance_days_before: number };
const DEFAULTS: BookingSettings = { deposit_mode: "full", deposit_percent: 25, balance_due: "arrival", balance_days_before: 7 };

export async function loadBookingSettings(companyId: string): Promise<BookingSettings> {
  const { data, error } = await supabaseAdmin.from("marina_booking_settings").select("deposit_mode, deposit_percent, balance_due, balance_days_before").eq("company_id", companyId).maybeSingle();
  if (error || !data) return DEFAULTS;
  return {
    deposit_mode: ["percent", "first_night"].includes(data.deposit_mode) ? data.deposit_mode : "full",
    deposit_percent: Number(data.deposit_percent) || 25,
    balance_due: data.balance_due === "days_before" ? "days_before" : "arrival",
    balance_days_before: Number(data.balance_days_before) || 7,
  };
}

const minusDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const PER_NIGHT: Record<string, number> = { transient_daily: 1, transient_weekly: 7, monthly: 30 };

// What is paid now and what is left for later. A booking that starts before the balance would
// be due is paid in full.
export function splitPayment(s: BookingSettings, total: number, unitPrice: number, stay: string, start: string) {
  const full = { payNow: round2(total), balance: 0, balanceDue: null as string | null };
  if (s.deposit_mode === "full") return full;
  const deposit = s.deposit_mode === "percent" ? round2(total * (s.deposit_percent / 100)) : round2(unitPrice / (PER_NIGHT[stay] || 1));
  if (!(deposit > 0) || deposit >= total - 0.5) return full;
  const due = s.balance_due === "arrival" ? start : minusDays(start, s.balance_days_before);
  if (due <= todayET()) return full;
  return { payNow: deposit, balance: round2(total - deposit), balanceDue: due };
}

// Is the signed-in boater a city/county resident at a marina that uses resident rates?
export async function residentPricingFor(companyId: string, memberId: string | null): Promise<boolean> {
  if (!memberId) return false;
  const [{ data: setting }, { data: m }] = await Promise.all([
    supabaseAdmin.from("company_modules").select("enabled").eq("company_id", companyId).eq("module_name", "marina_resident_pricing").maybeSingle(),
    supabaseAdmin.from("marina_members").select("is_resident").eq("id", memberId).eq("company_id", companyId).maybeSingle(),
  ]);
  return !!setting?.enabled && !!m?.is_resident;
}

export const newBookingToken = () => crypto.randomBytes(16).toString("hex");

export async function loadBookingByLink(companyId: string, id: string, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data: r } = await supabaseAdmin.from("marina_reservations").select("*").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (!r?.access_token) return null;
  const a = Buffer.from(String(r.access_token)), b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return r;
}

// Money picture of a booking: paid so far, balance left on the balance invoice.
export async function bookingMoney(companyId: string, r: any) {
  const ids = [r.invoice_id, r.balance_invoice_id].filter(Boolean);
  const [{ data: invs }, { data: pays }] = await Promise.all([
    supabaseAdmin.from("marina_invoices").select("id, amount, status, invoice_number").eq("company_id", companyId).in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at, pending_at").eq("company_id", companyId).in("invoice_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const paidOn = (id: string) => round2((pays || []).filter((p: any) => p.invoice_id === id && !p.returned_at).reduce((a: number, p: any) => a + Number(p.amount), 0));
  const first = (invs || []).find((i: any) => i.id === r.invoice_id);
  const bal = (invs || []).find((i: any) => i.id === r.balance_invoice_id);
  const paid = round2((first ? paidOn(first.id) : 0) + (bal ? paidOn(bal.id) : 0));
  const balanceLeft = bal && bal.status !== "void" ? round2(Math.max(0, Number(bal.amount) - paidOn(bal.id))) : 0;
  return { paid, balanceLeft, balanceInvoiceId: bal?.id || null, confirmation: first?.invoice_number || null };
}

// After the deposit is paid: the balance becomes its own invoice (due on the balance date), so it
// shows in the office's Invoices and can be paid from the booking page. Safe to call twice.
export async function createBalanceInvoice(companyId: string, r: any) {
  if (!r?.deposit_amount || r.balance_invoice_id) return;
  const balance = round2(Number(r.amount) - Number(r.deposit_amount));
  if (!(balance > 0)) return;
  const { data: slip } = await supabaseAdmin.from("marina_slips").select("slip_name").eq("id", r.slip_id).eq("company_id", companyId).maybeSingle();
  const today = todayET();
  for (let i = 0; i < 5; i++) {
    const number = `WEB-${today.replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from("marina_invoices").insert({
      company_id: companyId, invoice_number: number, category: "slip_fee", slip_id: r.slip_id, member_id: r.member_id ?? null,
      customer_name: r.guest_name, customer_email: r.guest_email,
      description: `Balance for slip ${slip?.slip_name || ""} reservation, ${r.start_date} to ${r.end_date}`,
      amount: balance, issue_date: today, due_date: r.balance_due_date || r.start_date,
    }).select("id").single();
    if (data) {
      const { data: set } = await supabaseAdmin.from("marina_reservations").update({ balance_invoice_id: data.id }).eq("id", r.id).eq("company_id", companyId).is("balance_invoice_id", null).select("id");
      if (!set?.length) await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Duplicate balance invoice" }).eq("id", data.id).eq("company_id", companyId);
      return;
    }
    if (error?.code !== "23505") return;
  }
}
