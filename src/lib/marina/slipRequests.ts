import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadPublicSlips, type PublicSlip } from "@/lib/marina/data";
import { rankSlips, type BoatDims } from "@/lib/marina/fit";

// Oct 26 (per Mely — request → contract → deposit → confirmed): shared by the request API,
// the tracker page, the Boater login card and the payment / signing hooks.

export const STAY_LABEL: Record<string, string> = { monthly: "Monthly", seasonal: "Seasonal", annual: "Annual" };

export function addDaysISO(iso: string, n: number) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMonthsISO(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// Is a public slip free for every night of [start, endInclusive]?
export function slipFreeFor(s: PublicSlip, start: string, endInclusive: string) {
  if (s.status === "maintenance") return false;
  const endEx = addDaysISO(endInclusive, 1);
  const takenByOwner = (s.kept || s.status === "occupied") && !(s.available_from && s.available_from <= start);
  if (takenByOwner) return false;
  if (s.status === "reserved" && !s.booked.length) return false;
  return !s.booked.some(([a, b]) => a < endEx && b > start);
}

export async function recommendSlips(companyId: string, boat: BoatDims, start: string, endInclusive: string, type?: string | null) {
  const slips = await loadPublicSlips(companyId);
  const free = slips.filter((s) => slipFreeFor(s, start, endInclusive) && (!type || s.slip_type === type));
  return { slips, ranked: rankSlips(free, boat) };
}

export const newRequestToken = () => crypto.randomBytes(16).toString("hex");

export function sameToken(a: string | null | undefined, b: string | null | undefined) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function loadRequestByLink(companyId: string, number: string, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { data: r, error } = await supabaseAdmin.from("marina_slip_requests").select("*").eq("company_id", companyId).eq("request_number", number).maybeSingle();
  if (error || !r || !sameToken(r.access_token, token)) return null;
  return r;
}

// Live picture of a request for the boater: which step, what to do next.
export async function requestProgress(companyId: string, r: any) {
  const [{ data: slip }, { data: k }] = await Promise.all([
    r.slip_id ? supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null } as any),
    r.contract_id ? supabaseAdmin.from("marina_contracts").select("status, signed_at, amount, deposit, invoice_ids").eq("id", r.contract_id).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  let depositPaid = false, depositDue: number | null = null;
  const ids: string[] = Array.isArray(k?.invoice_ids) ? k.invoice_ids : [];
  if (ids.length) {
    const [{ data: invs }, { data: pays }] = await Promise.all([
      supabaseAdmin.from("marina_invoices").select("id, category, amount, status").eq("company_id", companyId).in("id", ids),
      supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at").eq("company_id", companyId).in("invoice_id", ids),
    ]);
    const dep = (invs || []).find((i: any) => i.category === "security_deposit") || (invs || [])[0];
    if (dep) {
      const paid = (pays || []).filter((p: any) => p.invoice_id === dep.id && !p.returned_at).reduce((a: number, p: any) => a + Number(p.amount), 0);
      depositPaid = paid >= Number(dep.amount) - 0.005;
      depositDue = depositPaid ? 0 : Math.round((Number(dep.amount) - paid) * 100) / 100;
    }
  }
  // Steps: Request sent · Price · Contract signed · Deposit paid · Confirmed (number of steps done)
  const step = r.status === "requested" || r.status === "quoted" ? 1 : r.status === "quote_accepted" || r.status === "contract_sent" ? 2 : r.status === "signed" ? (depositPaid ? 4 : 3) : r.status === "confirmed" ? 5 : 0;
  return { slip: slip ? `${slip.slip_name}${slip.dock ? ` · ${slip.dock}` : ""}` : null, contractStatus: k?.status || null, amount: k?.amount ?? r.quoted_amount, deposit: k?.deposit ?? r.deposit_amount, depositPaid, depositDue, step };
}

// Called after a contract is signed (website contracts route).
export async function slipRequestSigned(companyId: string, contractId: string) {
  const { data } = await supabaseAdmin.from("marina_slip_requests").update({ status: "signed", signed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("company_id", companyId).eq("contract_id", contractId).eq("status", "contract_sent").select("*").then((x) => x, () => ({ data: null } as any));
  const r = data?.[0];
  if (r) await requestEmails(companyId, r, "signed").catch(() => null);
}

// Oct 26 (per Mely — every email automatic): the office and the boater hear about each step.
async function requestEmails(companyId: string, r: any, step: "signed" | "confirmed") {
  const [{ getMarinaById }, auto] = await Promise.all([import("./company"), import("./slipAuto")]);
  const company = await getMarinaById(companyId);
  if (!company) return;
  const { data: slip } = r.slip_id ? await supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).eq("company_id", companyId).maybeSingle() : { data: null as any };
  const name = String(r.full_name).replace(/[<>&"]/g, "");
  if (step === "signed") {
    await auto.mailOffice(company, `${r.full_name} signed the contract for slip ${slip?.slip_name || ""}`, [`<b>${name}</b> signed the contract for slip <b>${slip?.slip_name || ""}</b> (request ${r.request_number}). When the deposit is paid the slip is confirmed automatically.`], undefined, "requests");
    return;
  }
  await auto.mailOffice(company, `Confirmed: slip ${slip?.slip_name || ""} for ${r.full_name}`, [`The deposit is paid. <b>${name}</b> is confirmed in slip <b>${slip?.slip_name || ""}</b> from ${r.start_date} (request ${r.request_number}). The boat is placed in the slip.`], undefined, "requests");
  await auto.mailBoater(company, r.email, `Confirmed: slip ${slip?.slip_name || ""} is yours`, `Welcome aboard, ${String(r.full_name).split(" ")[0]}!`, [
    `Your deposit was received and slip <b>${slip?.slip_name || ""}</b>${slip?.dock ? ` (${slip.dock})` : ""} is confirmed from ${r.start_date}.`,
    "Your contract, invoices and marina pass are in your boater account.",
  ], { label: "Open my account", url: `https://${company.domain}/marina/account` });
}

// Called when a payment is recorded on an invoice: the deposit (or the first invoice when there is
// no deposit) confirms the request and places the boat in its slip.
export async function slipRequestPaidForInvoice(companyId: string, invoiceId: string) {
  const { data: inv } = await supabaseAdmin.from("marina_invoices").select("id, contract_id, category, amount").eq("id", invoiceId).eq("company_id", companyId).maybeSingle();
  if (!inv?.contract_id) return;
  const { data: r, error } = await supabaseAdmin.from("marina_slip_requests").select("*").eq("company_id", companyId).eq("contract_id", inv.contract_id).in("status", ["signed", "contract_sent"]).maybeSingle();
  if (error || !r) return;
  const { data: k } = await supabaseAdmin.from("marina_contracts").select("deposit, status").eq("id", inv.contract_id).eq("company_id", companyId).maybeSingle();
  if (k?.status !== "signed") return;
  const confirmsIt = Number(k?.deposit) > 0 ? inv.category === "security_deposit" : true;
  if (!confirmsIt) return;
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("amount, returned_at").eq("company_id", companyId).eq("invoice_id", inv.id);
  const paid = (pays || []).filter((p: any) => !p.returned_at).reduce((a: number, p: any) => a + Number(p.amount), 0);
  if (paid < Number(inv.amount) - 0.005) return;
  const now = new Date().toISOString();
  const { data: done } = await supabaseAdmin.from("marina_slip_requests").update({ status: "confirmed", confirmed_at: now, updated_at: now }).eq("id", r.id).eq("company_id", companyId).in("status", ["signed", "contract_sent"]).select("id");
  if (!done?.length) return;
  if (r.boat_id && r.slip_id) {
    await supabaseAdmin.from("marina_boats").update({ slip_id: r.slip_id, contract_type: r.stay_type }).eq("id", r.boat_id).eq("company_id", companyId);
    await supabaseAdmin.from("marina_slips").update({ status: r.start_date <= new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) ? "occupied" : "reserved" }).eq("id", r.slip_id).eq("company_id", companyId).neq("status", "maintenance");
  }
  await requestEmails(companyId, r, "confirmed").catch(() => null);
  if (r.waitlist_id) await supabaseAdmin.from("marina_waitlist").update({ status: "assigned" }).eq("id", r.waitlist_id).eq("company_id", companyId).then(() => null, () => null);
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: companyId, resident_name: r.full_name, update_type: "slip_request", message: `Slip request ${r.request_number} confirmed: deposit paid by ${r.full_name}. The boat is assigned to its slip.` }).then(() => null, () => null);
}

export const quoteExpired = (r: any) => r.status === "quoted" && !!r.quote_expires_at && Date.parse(r.quote_expires_at) < Date.now();
