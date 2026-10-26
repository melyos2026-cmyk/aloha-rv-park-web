import { supabaseAdmin } from "@/lib/supabase-admin";
import type { MarinaCompany } from "./company";
import { isDemoCompany } from "./host";
import { recommendSlips } from "./slipRequests";
import { priceFor, extrasFor, paymentTerms, sendContract, resend, escHtml, money } from "./contractCore";

// Oct 26 (per Mely — "todo a la facilidad del cliente"; "todos los email deben ser automaticos"):
//  · Automatic mode (default): the boater sees the price at once (Slips & Rates + the fee schedule's
//    deposit); when they accept, the contract is sent by itself. The office only steps in when no
//    free slip fits, a rate is missing, or there is no contract template.
//  · "Office approves first": everything waits for the office, like before.
//  · Every step emails the office (Booking settings → office email, else the marina's contact email).

export type RequestSettings = { request_mode: "automatic" | "office_first"; default_template_id: string | null; office_email: string | null; docs_before_sign: boolean; quote_valid_days: number };

export async function requestSettings(companyId: string): Promise<RequestSettings> {
  const { data, error } = await supabaseAdmin.from("marina_booking_settings").select("*").eq("company_id", companyId).maybeSingle();
  const d: any = error ? null : data;
  return {
    request_mode: d?.request_mode === "office_first" ? "office_first" : "automatic",
    default_template_id: d?.default_template_id || null,
    office_email: d?.office_email || null,
    docs_before_sign: d?.docs_before_sign !== false,
    quote_valid_days: Number(d?.quote_valid_days) || 7,
  };
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
async function officeAddress(company: MarinaCompany) {
  const s = await requestSettings(company.id);
  const a = (s.office_email || company.contact_email || "").trim();
  return EMAIL_RE.test(a) ? a : null;
}

// Short email to the office. Demo marinas never email.
export async function mailOffice(company: MarinaCompany, subject: string, lines: string[], button?: { label: string; url: string }) {
  if (isDemoCompany(company) || !company.domain) return;
  const to = await officeAddress(company);
  if (!to) return;
  try {
    await resend.emails.send({
      from: `MelyOS for ${company.company_name} <noreply@aloharvparkfl.com>`, to, subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f2540">${lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join("")}${button ? `<p><a href="${button.url}" style="display:inline-block;background:#0f2540;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">${escHtml(button.label)}</a></p>` : ""}<p style="color:#94a3b8;font-size:12px">Automatic message from your marina system.</p></div>`,
    });
  } catch (e: any) { console.error("office email failed:", e?.message); }
}

export async function mailBoater(company: MarinaCompany, to: string, subject: string, title: string, lines: string[], button?: { label: string; url: string }) {
  if (isDemoCompany(company) || !company.domain || !EMAIL_RE.test(to)) return false;
  try {
    await resend.emails.send({
      from: `${company.company_name} <noreply@aloharvparkfl.com>`, to, subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f2540"><h2 style="margin:0 0 8px">${escHtml(title)}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}${button ? `<p><a href="${button.url}" style="display:inline-block;background:#0f2540;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escHtml(button.label)}</a></p>` : ""}${company.contact_phone ? `<p style="color:#64748b;font-size:13px">Questions? Call ${escHtml(company.contact_phone)}.</p>` : ""}</div>`,
    });
    return true;
  } catch (e: any) { console.error("boater email failed:", e?.message); return false; }
}

export const trackerLink = (company: MarinaCompany, r: { request_number: string; access_token: string }) => `https://${company.domain}/marina/request/${encodeURIComponent(r.request_number)}?t=${r.access_token}`;

export async function defaultTemplateId(companyId: string, s?: RequestSettings) {
  const st = s || (await requestSettings(companyId));
  const { data } = await supabaseAdmin.from("marina_contract_templates").select("id, active").eq("company_id", companyId).order("created_at", { ascending: true });
  const active = (data || []).filter((t: any) => t.active !== false);
  return (st.default_template_id && active.some((t: any) => t.id === st.default_template_id) ? st.default_template_id : active[0]?.id) || null;
}

// Price the request now. Returns the quote or why the office has to look at it.
export async function autoQuote(company: MarinaCompany, r: any): Promise<{ ok: true; details: any; expires: string } | { ok: false; reason: string }> {
  const s = await requestSettings(company.id);
  if (s.request_mode !== "automatic") return { ok: false, reason: "The marina reviews every request first." };
  const boat = { length: Number(r.boat_length_ft), beam: r.boat_beam_ft ? Number(r.boat_beam_ft) : null, draft: r.boat_draft_ft ? Number(r.boat_draft_ft) : null, power: r.power_needed || null };
  const { ranked } = await recommendSlips(company.id, boat, r.start_date, r.end_date, r.slip_type_wanted);
  if (!ranked.length) return { ok: false, reason: "No free slip fits this boat for these dates." };
  const pick = (r.preferred_slip_id && ranked.find((x) => x.slip.id === r.preferred_slip_id)) || ranked[0];
  const body = { contract_type: r.stay_type, start_date: r.start_date, end_date: r.end_date, billing: r.stay_type === "annual" ? "single" : "monthly", slip_id: pick.slip.id, member_id: r.member_id, deposit: true, extras: [] as string[] };
  const price = await priceFor(company.id, body);
  if ("error" in price) return { ok: false, reason: price.error || "No rate for this stay in Slips & Rates." };
  const ex = await extrasFor(company.id, body, price.months);
  const terms = paymentTerms(price.amount, price.billing, price.installments, price.start);
  const expires = new Date(Date.now() + s.quote_valid_days * 86400000).toISOString();
  const details = {
    slip_id: pick.slip.id, slip_name: pick.slip.slip_name, dock: pick.slip.dock, start: r.start_date, end: r.end_date, billing: body.billing, deposit_on: true, extras_names: [],
    amount: price.amount, source: price.source, terms, extras: ex.chosen, extrasTotal: ex.extrasTotal, deposit: ex.deposit, total: price.amount + ex.extrasTotal,
    template_id: await defaultTemplateId(company.id, s), message: null, automatic: true,
  };
  const now = new Date().toISOString();
  const { data: done } = await supabaseAdmin.from("marina_slip_requests").update({
    status: "quoted", slip_id: pick.slip.id, quoted_amount: price.amount, deposit_amount: ex.deposit || null,
    quote_details: details, quoted_at: now, quote_expires_at: expires, status_by_name: "Automatic", updated_at: now,
  }).eq("id", r.id).eq("company_id", company.id).eq("status", "requested").select("id");
  if (!done?.length) return { ok: false, reason: "The price could not be saved; please send it from Slip Requests." };
  await supabaseAdmin.from("marina_slip_requests").update({ auto: true }).eq("id", r.id).eq("company_id", company.id).then(() => null, () => null);
  return { ok: true, details, expires };
}

// The boater accepted: owner + boat (new or existing) → contract sent by itself.
export async function autoContract(company: MarinaCompany, r: any): Promise<{ ok: true; emailed: boolean } | { ok: false; reason: string }> {
  const s = await requestSettings(company.id);
  if (s.request_mode !== "automatic") return { ok: false, reason: "The office sends the contract." };
  const q = r.quote_details || {};
  const templateId = q.template_id || (await defaultTemplateId(company.id, s));
  if (!templateId) return { ok: false, reason: "There is no contract template yet (Contracts → Templates)." };
  let memberId = r.member_id as string | null;
  if (!memberId) {
    const { data: found } = await supabaseAdmin.from("marina_members").select("id, email").eq("company_id", company.id).ilike("email", String(r.email).replace(/[%_\\]/g, "\\$&")).limit(5);
    memberId = (found || []).find((m: any) => String(m.email).toLowerCase() === String(r.email).toLowerCase())?.id || null;
    if (!memberId) {
      const { data: m, error } = await supabaseAdmin.from("marina_members").insert({ company_id: company.id, full_name: r.full_name, email: r.email, phone: r.phone, is_resident: false, notes: `From slip request ${r.request_number}` }).select("id").single();
      if (error) return { ok: false, reason: error.message };
      memberId = m.id;
    }
  }
  let boatId = r.boat_id as string | null;
  if (!boatId) {
    const name = (r.boat_name || "").trim() || `${String(r.full_name).split(" ")[0]}'s boat`;
    const { data: existing } = await supabaseAdmin.from("marina_boats").select("id, boat_name").eq("company_id", company.id).eq("member_id", memberId);
    boatId = (existing || []).find((x: any) => String(x.boat_name).toLowerCase() === name.toLowerCase())?.id || null;
    if (!boatId) {
      const { data: bt, error } = await supabaseAdmin.from("marina_boats").insert({ company_id: company.id, member_id: memberId, boat_name: name, make_model: r.boat_make_model || null, length_ft: r.boat_length_ft, beam_ft: r.boat_beam_ft, draft_ft: r.boat_draft_ft, contract_type: r.stay_type }).select("id").single();
      if (error) return { ok: false, reason: error.message };
      boatId = bt.id;
    }
  }
  await supabaseAdmin.from("marina_boat_documents").update({ boat_id: boatId }).eq("company_id", company.id).eq("request_id", r.id).is("boat_id", null).then(() => null, () => null);
  const sent = await sendContract(company.id, { name: "Automatic" }, {
    contract_type: r.stay_type, start_date: q.start || r.start_date, end_date: q.end || r.end_date, billing: q.billing, slip_id: q.slip_id || r.slip_id,
    member_id: memberId, boat_id: boatId, deposit: q.deposit_on !== false, extras: q.extras_names || [], template_id: templateId,
    override: q.override || undefined, amount: q.override_amount ?? undefined, override_reason: q.override_reason || undefined,
  });
  if ("error" in sent) return { ok: false, reason: sent.error };
  const { data: k } = await supabaseAdmin.from("marina_contracts").select("amount, deposit").eq("id", sent.id).maybeSingle();
  const now = new Date().toISOString();
  await supabaseAdmin.from("marina_slip_requests").update({
    status: "contract_sent", member_id: memberId, boat_id: boatId, contract_id: sent.id, quoted_amount: k?.amount ?? r.quoted_amount, deposit_amount: k?.deposit ?? r.deposit_amount,
    contract_sent_at: now, status_by_name: "Automatic", updated_at: now,
  }).eq("id", r.id).eq("company_id", company.id);
  await supabaseAdmin.from("marina_messages").insert({
    company_id: company.id, member_id: memberId, direction: "office", sent_by_name: "Marina office",
    subject: `Your contract for slip ${q.slip_name || ""} is ready`.slice(0, 200),
    body: `Thank you for accepting the price. Your contract is in Contracts to sign. After you sign, pay the deposit in your account to confirm the slip.`,
  }).then(() => null, () => null);
  return { ok: true, emailed: sent.emailed };
}

export const moneyText = money;
