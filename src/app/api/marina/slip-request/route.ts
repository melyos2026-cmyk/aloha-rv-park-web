import crypto from "crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { isDemoCompany } from "@/lib/marina/host";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { todayET } from "@/lib/marina/data";
import { recommendSlips, newRequestToken, addDaysISO, addMonthsISO, STAY_LABEL } from "@/lib/marina/slipRequests";
import { fitCheck } from "@/lib/marina/fit";

// POST /api/marina/slip-request — Oct 26 (per Mely): a boater asks for a monthly, seasonal or
// annual slip. The request carries the boat's size and power; the system checks the fit and saves
// the best free slips for the office. The boater gets a private tracker link.
const resend = new Resend(process.env.RESEND_API_KEY);
const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const feet = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 10) / 10 : null; };
const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (text(b.website, 50)) return NextResponse.json({ ok: true });
  if (await tooManyFromIp(req, `slipreq:${company.id}`, 5)) return NextResponse.json({ error: "Too many requests from this device. Please call the marina office." }, { status: 429 });
  const { count } = await supabaseAdmin.from("marina_slip_requests").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count || 0) >= 40) return NextResponse.json({ error: "Too many requests right now. Please call the marina office." }, { status: 429 });

  const s = await getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  let name = text(b.full_name, 120), email = text(b.email, 160).toLowerCase(), phone = text(b.phone, 40);
  if (memberId) {
    const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", memberId).eq("company_id", company.id).maybeSingle();
    name = name || m?.full_name || ""; email = email || (m?.email || "").toLowerCase(); phone = phone || m?.phone || "";
  }
  if (name.length < 2) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (phone.length < 7) return NextResponse.json({ error: "Enter a phone number the office can call." }, { status: 400 });
  const length = feet(b.boat_length_ft);
  if (!length) return NextResponse.json({ error: "Enter your boat length." }, { status: 400 });
  const beam = feet(b.boat_beam_ft), draft = feet(b.boat_draft_ft);
  const power = ["30A", "50A", "100A"].includes(String(b.power_needed)) ? String(b.power_needed) : null;
  const stay = String(b.stay_type);
  if (!["monthly", "seasonal", "annual"].includes(stay)) return NextResponse.json({ error: "Choose monthly, seasonal or annual." }, { status: 400 });
  const start = text(b.start_date, 10);
  const today = todayET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < today || start > addDaysISO(today, 400)) return NextResponse.json({ error: "Choose a start date from today to a year from now." }, { status: 400 });
  const months = stay === "annual" ? 12 : Math.max(1, Math.min(stay === "seasonal" ? 9 : 11, Math.floor(Number(b.months) || (stay === "seasonal" ? 6 : 1))));
  const end = addDaysISO(addMonthsISO(start, months), -1);
  const type = ["wet", "lift", "dry"].includes(String(b.slip_type)) ? String(b.slip_type) : null;

  const boat = { length, beam, draft, power };
  const { slips, ranked } = await recommendSlips(company.id, boat, start, end, type);
  const pref = b.preferred_slip_id ? slips.find((x) => x.id === String(b.preferred_slip_id)) : null;
  if (pref) {
    const f = fitCheck(pref, boat);
    if (!f.fits) return NextResponse.json({ error: `Slip ${pref.slip_name} doesn't fit your boat: ${f.checks.filter((c) => !c.ok).map((c) => c.detail).join("; ")}.` }, { status: 400 });
  }

  const token = newRequestToken();
  let row: any = null;
  for (let i = 0; i < 5 && !row; i++) {
    const number = `SR-${today.replace(/-/g, "").slice(2)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from("marina_slip_requests").insert({
      company_id: company.id, request_number: number, access_token: token, member_id: memberId,
      full_name: name, email, phone, boat_name: text(b.boat_name, 80) || null, boat_make_model: text(b.boat_make_model, 120) || null,
      boat_length_ft: length, boat_beam_ft: beam, boat_draft_ft: draft, power_needed: power, stay_type: stay, slip_type_wanted: type,
      start_date: start, end_date: end, preferred_slip_id: pref?.id || null, recommended_slip_ids: ranked.slice(0, 5).map((x) => x.slip.id), notes: text(b.notes, 1000) || null,
    }).select("request_number").single();
    if (data) row = data; else if (error?.code !== "23505") return NextResponse.json({ error: /marina_slip_requests/.test(error?.message || "") ? "Slip requests are not set up yet. Please call the marina." : "Could not send your request. Please try again." }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 });

  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "slip_request",
    message: `New slip request ${row.request_number}: ${STAY_LABEL[stay]} from ${start}, ${length} ft boat${pref ? `, asked for ${pref.slip_name}` : ""}. ${ranked.length ? `${ranked.length} free slip${ranked.length === 1 ? "" : "s"} fit.` : "No free slip fits these dates."}`,
  }).then(() => null, () => null);

  const link = `https://${company.domain}/marina/request/${encodeURIComponent(row.request_number)}?t=${token}`;
  if (!isDemoCompany(company) && company.domain) {
    try {
      await resend.emails.send({
        from: `${company.company_name} <noreply@aloharvparkfl.com>`, to: email, subject: `We got your slip request (${row.request_number})`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f2540"><h2 style="margin:0 0 8px">Thanks, ${esc(name)}!</h2><p>We received your ${esc(STAY_LABEL[stay].toLowerCase())} slip request for a ${esc(length)} ft boat starting ${esc(start)}. The office will review it and send you a contract with the price.</p><p><a href="${link}" style="display:inline-block;background:#0f2540;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Track my request</a></p></div>`,
      });
    } catch (e: any) { console.error("slip request email failed:", e?.message); }
  }
  return NextResponse.json({ ok: true, number: row.request_number, link: `/marina/request/${encodeURIComponent(row.request_number)}?t=${token}`, fits: ranked.length });
}

// GET — the signed-in boater's own requests (Boater login card).
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ requests: [] });
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return NextResponse.json({ requests: [] });
  const { data: m } = await supabaseAdmin.from("marina_members").select("email").eq("id", s.memberId).eq("company_id", company.id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("marina_slip_requests").select("request_number, access_token, status, stay_type, start_date, end_date, boat_name, member_id, email")
    .eq("company_id", company.id).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ requests: [] });
  const mine = (data || []).filter((r: any) => r.member_id === s.memberId || (m?.email && String(r.email).toLowerCase() === String(m.email).toLowerCase())).slice(0, 10);
  return NextResponse.json({ requests: mine.map((r: any) => ({ number: r.request_number, status: r.status, stay: r.stay_type, start: r.start_date, end: r.end_date, boat: r.boat_name, link: `/marina/request/${encodeURIComponent(r.request_number)}?t=${r.access_token}` })) });
}
