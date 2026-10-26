// Oct 26 (per Mely — automatic slip requests): the contract price and sending, the SAME code as the
// admin app (melyos-builder lib/marinaContracts.ts), so the website can show the price at once and
// send the contract by itself when the boater accepts. Keep both copies in step.
import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { round2, todayET } from "./data";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export async function currentSchedule(companyId: string) {
  const { data } = await supabaseAdmin.from("marina_fee_schedules").select("*").eq("company_id", companyId).lte("effective_date", todayET()).order("effective_date", { ascending: false }).limit(1);
  return data?.[0] || null;
}

export const resend = new Resend(process.env.RESEND_API_KEY);
export const isDemo = (domain: string | null | undefined, flag: any) => !!flag || /(^|\.)melyos\.io$/.test(String(domain || ""));
export const longDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
export const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const hash = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
export const escHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Months covered by a term (start through end, inclusive); a partial month counts as one.
export function termMonths(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const e = new Date(Date.UTC(...(end.split("-").map(Number) as [number, number, number])) + 86400000);
  const ey = e.getUTCFullYear(), em = e.getUTCMonth() + 1, ed = e.getUTCDate();
  let m = (ey - sy) * 12 + (em - sm);
  if (ed > sd) m += 1;
  return Math.max(1, m);
}
export const TYPE_LABEL: Record<string, string> = { annual: "Annual", seasonal: "Seasonal", monthly: "Monthly" };

// Oct 21 (per Mely): the contract price ALWAYS comes from Slips & Rates (the one
// price table), unless the office types a different price with a written reason.
export async function priceFor(companyId: string, b: any) {
  const type = ["annual", "seasonal", "monthly"].includes(b.contract_type) ? b.contract_type : "";
  if (!type) return { error: "Choose the contract type (annual, seasonal or monthly)." };
  const start = String(b.start_date || ""), end = String(b.end_date || "");
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || end < start) return { error: "Enter the start and end dates of the contract." };
  const months = termMonths(start, end);
  const billing = b.billing === "monthly" ? "monthly" : "single";
  const installments = billing === "monthly" ? months : 1;

  if (b.override) {
    const amount = Number(String(b.amount ?? "").replace(/[$,\s]/g, ""));
    const reason = String(b.override_reason || "").trim().slice(0, 300);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the different price." };
    if (!reason) return { error: "Write why this contract uses a different price than Slips & Rates." };
    return { type, start, end, months, billing, installments, amount: round2(amount), source: "Different price set by the office", reason };
  }

  const slipId = b.slip_id || null;
  if (!slipId) return { error: "Choose the slip. The price comes from that slip's rates in Slips & Rates." };
  const [{ data: slip }, { data: rate }, { data: member }, { data: setting }] = await Promise.all([
    supabaseAdmin.from("marina_slips").select("slip_name").eq("id", slipId).eq("company_id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_slip_rates").select("resident_rate, non_resident_rate").eq("company_id", companyId).eq("slip_id", slipId).eq("rate_type", type).maybeSingle(),
    supabaseAdmin.from("marina_members").select("is_resident").eq("id", b.member_id || "").eq("company_id", companyId).maybeSingle(),
    supabaseAdmin.from("company_modules").select("enabled").eq("company_id", companyId).eq("module_name", "marina_resident_pricing").maybeSingle(),
  ]);
  const resident = !!setting?.enabled && !!member?.is_resident;
  const unit = resident ? (rate?.resident_rate ?? rate?.non_resident_rate) : (rate?.non_resident_rate ?? rate?.resident_rate);
  if (!(Number(unit) > 0)) return { error: `Slip ${slip?.slip_name || ""} has no ${TYPE_LABEL[type].toLowerCase()} rate in Slips & Rates. Add it there first (or use a different price with a reason).` };
  const amount = round2(type === "monthly" ? Number(unit) * months : Number(unit));
  const which = !setting?.enabled ? "rate" : resident ? "resident rate" : "non-resident rate";
  const source = type === "monthly"
    ? `Slips & Rates · Monthly ${which} ${money(Number(unit))} × ${months} month${months === 1 ? "" : "s"}`
    : `Slips & Rates · ${TYPE_LABEL[type]} ${which}`;
  return { type, start, end, months, billing, installments, amount, source, reason: null as string | null };
}

// Oct 21 (per Mely): extras and deposit come from the fee schedule in effect (Fee Settings).
export async function extrasFor(companyId: string, b: any, months: number) {
  const sched: any = await currentSchedule(companyId);
  const offered: { name: string; amount: number; per: string }[] = Array.isArray(sched?.extra_charges) ? sched.extra_charges : [];
  const wanted: string[] = Array.isArray(b.extras) ? b.extras.map(String) : [];
  const chosen = offered.filter((x) => wanted.includes(x.name)).map((x) => ({
    name: x.name, amount: Number(x.amount), per: x.per === "one_time" ? "one_time" : "month",
    total: round2(x.per === "one_time" ? Number(x.amount) : Number(x.amount) * months),
  }));
  const deposit = b.deposit && Number(sched?.security_deposit) > 0 ? round2(Number(sched.security_deposit)) : null;
  return { offered, chosen, extrasTotal: round2(chosen.reduce((t, x) => t + x.total, 0)), deposit, scheduleDeposit: Number(sched?.security_deposit) > 0 ? Number(sched.security_deposit) : null };
}
export const extrasText = (chosen: { name: string; amount: number; per: string }[]) =>
  chosen.length ? chosen.map((x) => `${x.name} ${money(x.amount)}${x.per === "month" ? " per month" : " (one time)"}`).join("; ") : "none";

export function paymentTerms(amount: number, billing: string, installments: number, start: string): string {
  if (billing !== "monthly" || installments <= 1) return `in one payment due on ${longDate(start)}`;
  const each = Math.floor((amount / installments) * 100) / 100;
  return `in ${installments} monthly payments of ${money(each)}, the first due on ${longDate(start)} and the rest on the same day of each following month`;
}

export async function sendContract(companyId: string, actor: any, body: any): Promise<{ error: string; status: number } | { id: string; emailed: boolean }> {
  const { data: tpl } = await supabaseAdmin.from("marina_contract_templates").select("*").eq("id", body.template_id).eq("company_id", companyId).maybeSingle();
  if (!tpl) return { error: "Choose a contract template.", status: 400 };
  const { data: member } = await supabaseAdmin.from("marina_members").select("id, full_name, email").eq("id", body.member_id).eq("company_id", companyId).maybeSingle();
  if (!member) return { error: "Choose the boat owner.", status: 400 };
  if (!member.email) return { error: `${member.full_name} has no email on file. Add one in Boat Owners & Boats so they can sign in and sign.`, status: 400 };
  // Oct 22 (security): a renewal_id sent by the browser must belong to this company.
  if (body.renewal_id) {
    const { data: ren } = await supabaseAdmin.from("marina_renewals").select("id").eq("id", body.renewal_id).eq("company_id", companyId).maybeSingle();
    if (!ren) return { error: "Renewal not found.", status: 404 };
  }
  let boat: any = null, slip: any = null;
  if (body.boat_id) {
    const r = await supabaseAdmin.from("marina_boats").select("*").eq("id", body.boat_id).eq("company_id", companyId).eq("member_id", member.id).maybeSingle();
    boat = r.data;
    if (!boat) return { error: "That boat does not belong to this owner.", status: 400 };
  }
  const slipId = body.slip_id || boat?.slip_id || null;
  if (slipId) {
    const r = await supabaseAdmin.from("marina_slips").select("id, slip_name, dock, slip_type, length_ft, max_beam_ft, max_draft_ft, has_power, has_water, utilities_mode, utilities_flat_monthly").eq("id", slipId).eq("company_id", companyId).maybeSingle();
    slip = r.data;
  }
  const price = await priceFor(companyId, { ...body, member_id: member.id, slip_id: slip?.id || null });
  if ("error" in price) return { error: price.error || "Check the price.", status: 400 };
  const { start, end, amount } = price;
  const ex = await extrasFor(companyId, body, price.months);

  const { data: co } = await supabaseAdmin.from("companies").select("company_name, dba_name, address, city, state, zip_code, domain, is_demo").eq("id", companyId).maybeSingle();
  const marinaName = co?.dba_name || co?.company_name || "the Marina";
  const values: Record<string, string> = {
    today: longDate(new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })),
    marina_name: marinaName,
    marina_address: [co?.address, co?.city, [co?.state, co?.zip_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—",
    owner_name: member.full_name, owner_email: member.email || "—",
    boat_name: boat?.boat_name || "—", boat_make_model: boat?.make_model || "—",
    boat_length: boat?.length_ft ? String(boat.length_ft) : "—", boat_registration: boat?.registration_number || boat?.hull_id || "—",
    slip: slip ? `${slip.dock ? slip.dock + " " : ""}${slip.slip_name}` : "—",
    start_date: start ? longDate(start) : "—", end_date: end ? longDate(end) : "—",
    amount: money(amount),
    slip_details: slip ? [
      slip.slip_type === "lift" ? "lift slip" : slip.slip_type === "dry" ? "dry storage" : "wet slip",
      slip.length_ft ? `length ${slip.length_ft} ft` : "", slip.max_beam_ft ? `maximum beam ${slip.max_beam_ft} ft` : "", slip.max_draft_ft ? `maximum draft ${slip.max_draft_ft} ft` : "",
      `shore power: ${slip.has_power ? "yes" : "no"}`, `water: ${slip.has_water ? "yes" : "no"}`,
      slip.has_power ? `electricity: ${slip.utilities_mode === "included" ? "included in the dockage fee" : slip.utilities_mode === "flat" && Number(slip.utilities_flat_monthly) > 0 ? `flat ${money(Number(slip.utilities_flat_monthly))} per month` : "metered, billed separately"}` : "",
    ].filter(Boolean).join("; ") : "—",
    boat_beam: boat?.beam_ft ? String(boat.beam_ft) : "—", boat_draft: boat?.draft_ft ? String(boat.draft_ft) : "—",
    payment_terms: paymentTerms(amount, price.billing, price.installments, start),
    contract_type: TYPE_LABEL[price.type],
    extras: extrasText(ex.chosen),
    deposit: ex.deposit ? money(ex.deposit) : "none",
  };
  const text = String(tpl.body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
  const title = String(body.title || "").trim().slice(0, 120) || `${tpl.name.replace(/\s*\(sample\)\s*$/i, "")}${slip ? ` — Slip ${slip.slip_name}` : ""}`;
  const { data: k, error } = await supabaseAdmin.from("marina_contracts").insert({
    company_id: companyId, template_id: tpl.id, member_id: member.id, boat_id: boat?.id || null, slip_id: slip?.id || null,
    title, body: text, body_hash: hash(text), start_date: start, end_date: end,
    amount, sent_by_name: actor?.name || null,
    contract_type: price.type, price_source: price.source, price_override_reason: price.reason,
    billing: price.billing, installments: price.installments, extras: ex.chosen, deposit: ex.deposit,
    ...(body.renewal_id ? { renewal_id: body.renewal_id } : {}),
  }).select("id").single();
  if (error) return { error: error.message, status: 500 };

  let emailed = false;
  if (!isDemo(co?.domain, co?.is_demo) && co?.domain) {
    try {
      await resend.emails.send({
        from: `${marinaName} <noreply@aloharvparkfl.com>`,
        to: member.email,
        subject: `Please sign: ${title}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f2540">
          <h2 style="margin:0 0 8px">You have a contract to sign</h2>
          <p>Hi ${escHtml(member.full_name)}, ${escHtml(marinaName)} sent you <b>${escHtml(title)}</b>.</p>
          <p>Sign in to your boater account with this email address to read and sign it online.</p>
          <p><a href="https://${escHtml(co.domain)}/marina/account" style="display:inline-block;background:#0f2540;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Read and sign</a></p>
          <p style="color:#64748b;font-size:13px">If you have questions about the contract, contact the marina office before signing.</p>
        </div>`,
      });
      emailed = true;
    } catch (e: any) { console.error("contract email failed:", e?.message); }
  }
  return { id: k.id as string, emailed };
}

