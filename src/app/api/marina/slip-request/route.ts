import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { todayET } from "@/lib/marina/data";
import { recommendSlips, newRequestToken, addDaysISO, addMonthsISO, STAY_LABEL } from "@/lib/marina/slipRequests";
import { fitCheck } from "@/lib/marina/fit";
import { autoQuote, mailOffice, mailBoater, trackerLink } from "@/lib/marina/slipAuto";
import { money } from "@/lib/marina/contractCore";

// POST /api/marina/slip-request — Oct 26 (per Mely): a boater asks for a monthly, seasonal or
// annual slip. The request carries the boat's size and power; the system checks the fit and saves
// the best free slips for the office. The boater gets a private tracker link.
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
  // Oct 27 (per Mely — "para saber quién parquea"): date of birth of the person asking (18 or older).
  let dob = text(b.date_of_birth, 10);
  if (!dob && memberId) {
    const { data: md } = await supabaseAdmin.from("marina_members").select("date_of_birth").eq("id", memberId).eq("company_id", company.id).maybeSingle().then((x) => x, () => ({ data: null } as any));
    dob = md?.date_of_birth || "";
  }
  {
    const ok = /^\d{4}-\d{2}-\d{2}$/.test(dob) && !Number.isNaN(Date.parse(dob));
    const adult = ok && dob <= addMonthsISO(todayET(), -12 * 18) && dob >= addMonthsISO(todayET(), -12 * 110);
    if (!ok) return NextResponse.json({ error: "Enter your date of birth." }, { status: 400 });
    if (!adult) return NextResponse.json({ error: "The person renting the slip must be 18 or older." }, { status: 400 });
  }
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
  let withDob = true;
  for (let i = 0; i < 5 && !row; i++) {
    const number = `SR-${today.replace(/-/g, "").slice(2)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from("marina_slip_requests").insert({
      company_id: company.id, request_number: number, access_token: token, member_id: memberId,
      full_name: name, email, phone, ...(withDob ? { date_of_birth: dob } : {}), boat_name: text(b.boat_name, 80) || null, boat_make_model: text(b.boat_make_model, 120) || null,
      boat_length_ft: length, boat_beam_ft: beam, boat_draft_ft: draft, power_needed: power, stay_type: stay, slip_type_wanted: type,
      start_date: start, end_date: end, preferred_slip_id: pref?.id || null, recommended_slip_ids: ranked.slice(0, 5).map((x) => x.slip.id), notes: text(b.notes, 1000) || null,
    }).select("*").single();
    if (!data && error && /date_of_birth/.test(error.message || "")) { withDob = false; i--; continue; } // SQL 89 not run yet
    if (data) row = data; else if (error?.code !== "23505") return NextResponse.json({ error: /marina_slip_requests/.test(error?.message || "") ? "Slip requests are not set up yet. Please call the marina." : "Could not send your request. Please try again." }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 });

  // Oct 26 (per Mely): automatic mode → the price is ready right away (and held for some days).
  const auto = await autoQuote(company, row).catch((e: any) => ({ ok: false as const, reason: e?.message || "error" }));
  const link = trackerLink(company, row);
  const boatTxt = `${length} ft boat${row.boat_name ? ` "${esc(row.boat_name)}"` : ""}`;
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "slip_request",
    message: auto.ok
      ? `New slip request ${row.request_number}: ${STAY_LABEL[stay]} from ${start}, ${length} ft boat. The system offered slip ${auto.details.slip_name} at ${money(auto.details.total)}; waiting for the boater to accept.`
      : `New slip request ${row.request_number}: ${STAY_LABEL[stay]} from ${start}, ${length} ft boat${pref ? `, asked for ${pref.slip_name}` : ""}. Needs the office: ${auto.reason}`,
  }).then(() => null, () => null);
  await mailOffice(company, auto.ok ? `New slip request ${row.request_number}: price sent automatically` : `New slip request ${row.request_number}: needs your review`, [
    `<b>${esc(name)}</b> (${esc(email)}, ${esc(phone)}) asked for a <b>${esc(STAY_LABEL[stay].toLowerCase())}</b> slip from ${esc(start)} to ${esc(end)} for a ${boatTxt}.`,
    auto.ok ? `The system offered <b>slip ${esc(auto.details.slip_name)}</b> at <b>${money(auto.details.total)}</b>${auto.details.deposit ? ` + ${money(auto.details.deposit)} deposit` : ""}. Nothing to do: when they accept, the contract is sent by itself.` : `<b>Needs you:</b> ${esc(auto.reason)} Open Slip Requests to choose a slip and send the price, or decline.`,
    ...(row.notes ? [`Their note: “${esc(row.notes)}”`] : []),
  ], undefined, "requests");
  if (auto.ok) {
    await mailBoater(company, email, `Your price for slip ${auto.details.slip_name} (${row.request_number})`, `Your price is ready, ${name.split(" ")[0]}!`, [
      `Slip <b>${esc(auto.details.slip_name)}</b>${auto.details.dock ? ` (${esc(auto.details.dock)})` : ""} fits your ${boatTxt}, from ${esc(start)} to ${esc(end)}: <b>${money(auto.details.total)}</b>${auto.details.deposit ? ` plus a refundable deposit of ${money(auto.details.deposit)}` : ""}, paid ${esc(auto.details.terms)}.`,
      `It's held for you until ${esc(auto.expires.slice(0, 10))}. Accept it and your contract arrives by email to sign online.`,
    ], { label: "See and accept my price", url: link });
  } else {
    await mailBoater(company, email, `We got your slip request (${row.request_number})`, `Thanks, ${name}!`, [
      `We received your ${esc(STAY_LABEL[stay].toLowerCase())} slip request for a ${boatTxt} starting ${esc(start)}. The office will review it and send you the price.`,
    ], { label: "Track my request", url: link });
  }
  return NextResponse.json({ ok: true, number: row.request_number, link: `/marina/request/${encodeURIComponent(row.request_number)}?t=${token}`, fits: ranked.length, priced: auto.ok });
}

// GET — the signed-in boater's own requests (Boater login card).
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ requests: [] });
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return NextResponse.json({ requests: [] });
  // Oct 26 (security review): only requests submitted while signed in as this boater (member_id).
  // Matching by email also listed requests anyone typed that email into without signing in —
  // and handed out their private links (access_token). Those people got their link by email.
  const { data, error } = await supabaseAdmin.from("marina_slip_requests").select("request_number, access_token, status, stay_type, start_date, end_date, boat_name, member_id")
    .eq("company_id", company.id).eq("member_id", s.memberId).order("created_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ requests: [] });
  const mine = data || [];
  return NextResponse.json({ requests: mine.map((r: any) => ({ number: r.request_number, status: r.status, stay: r.stay_type, start: r.start_date, end: r.end_date, boat: r.boat_name, link: `/marina/request/${encodeURIComponent(r.request_number)}?t=${r.access_token}` })) });
}
