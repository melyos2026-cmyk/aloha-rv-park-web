import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { round2 } from "@/lib/marina/data";
import { moduleOn, loadConciergeSettings, toService } from "@/lib/concierge";

// Oct 23 (per Mely): concierge requests from the marina website.
// GET ?mine=1 → the signed-in boater's requests.   POST → new request.
// Fixed-price services are confirmed at once (charged to the account, or paid later at the
// office for guests); "quote" services wait for the office to set the price. The invoice is
// created by the admin when the request is confirmed (so quotes never bill before approval).
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  if (!memberId) return NextResponse.json({ requests: [] });
  const { data } = await supabaseAdmin.from("concierge_requests").select("id, request_number, wanted_at, units, slip_name, details, choices, quoted_price, total, payment, status, assigned_name, concierge_services(name, category, pricing, unit_label)")
    .eq("company_id", company.id).eq("member_id", memberId).order("wanted_at", { ascending: false }).limit(20);
  return NextResponse.json({ requests: (data || []).map((r: any) => ({ ...r, service: r.concierge_services?.name, category: r.concierge_services?.category, pricing: r.concierge_services?.pricing, concierge_services: undefined })) });
}

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await moduleOn(company.id, "concierge"))) return NextResponse.json({ error: "Requests are not available online right now. Please call the office." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  const settings = await loadConciergeSettings(company.id);

  const { data: row } = await supabaseAdmin.from("concierge_services").select("*").eq("id", String(b.service || "")).eq("company_id", company.id).eq("active", true).maybeSingle();
  if (!row) return NextResponse.json({ error: "That service is no longer offered." }, { status: 404 });
  const svc = toService(row);
  const wanted = new Date(String(b.wanted_at || ""));
  if (isNaN(wanted.getTime())) return NextResponse.json({ error: "Choose the date and time you need it." }, { status: 400 });
  if (wanted.getTime() < Date.now() + svc.lead_hours * 3600 * 1000) return NextResponse.json({ error: `Please request this at least ${svc.lead_hours} hour${svc.lead_hours === 1 ? "" : "s"} ahead.` }, { status: 400 });
  let units = Math.max(svc.min_units, Math.min(500, Math.round(Number(b.units) || svc.min_units)));
  // Choices the office defined for this service (which drinks, ice type…). Per-unit services take a quantity per choice.
  let choices: string | null = null;
  if (svc.options.length) {
    const picked = (Array.isArray(b.choices) ? b.choices : []).map((c: any) => ({ name: String(c?.name || "").trim(), qty: Math.max(0, Math.min(500, Math.round(Number(c?.qty) || 0))) }))
      .filter((c: any) => svc.options.includes(c.name) && c.qty > 0).slice(0, 40);
    if (!picked.length) return NextResponse.json({ error: `${svc.option_label || "Please choose"}: pick at least one.` }, { status: 400 });
    if (svc.pricing === "per_unit") units = Math.max(svc.min_units, Math.min(500, picked.reduce((n: number, c: any) => n + c.qty, 0)));
    choices = picked.map((c: any) => svc.pricing === "per_unit" && c.qty > 1 ? `${c.name} × ${c.qty}` : svc.pricing === "per_unit" ? c.name : c.name).join(", ");
  }

  let name = text(b.name, 120), email = text(b.email, 160).toLowerCase(), phone = text(b.phone, 40);
  if (memberId) {
    const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", memberId).eq("company_id", company.id).maybeSingle();
    name = name || m?.full_name || ""; email = email || (m?.email || "").toLowerCase(); phone = phone || m?.phone || "";
  }
  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });

  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin.from("concierge_requests").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", hourAgo);
  if ((count || 0) >= 60) return NextResponse.json({ error: "Too many requests right now. Please call the office." }, { status: 429 });

  const isQuote = svc.pricing === "quote" || svc.price == null;
  const subtotal = isQuote ? null : round2(svc.pricing === "fixed" ? svc.price! : svc.price! * units);
  const tax = subtotal != null && svc.taxable ? round2(subtotal * settings.taxRate / 100) : 0;
  const total = subtotal != null ? round2(subtotal + tax) : null;
  const number = `CR-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const payment = memberId ? "account" : "office";

  const { error } = await supabaseAdmin.from("concierge_requests").insert({
    company_id: company.id, service_id: svc.id, request_number: number, member_id: memberId,
    customer_name: name, customer_email: email, customer_phone: phone || null, wanted_at: wanted.toISOString(), units,
    slip_name: text(b.slip, 20) || null, boat_name: text(b.boat, 80) || null, details: text(b.details, 1500) || null, choices,
    subtotal, tax, total, payment, status: "requested",
  });
  if (error) return NextResponse.json({ error: "Could not send your request. Please try again." }, { status: 500 });
  const when = wanted.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "concierge_request",
    message: `New request ${number}: ${svc.name}${units > 1 ? ` × ${units}` : ""}${choices ? ` (${choices})` : ""} for ${when}${b.slip ? ` at slip ${text(b.slip, 20)}` : ""}${isQuote ? " — needs a quote" : ` — $${total!.toFixed(2)}`}.`,
  }).then(() => null, () => null);
  return NextResponse.json({ ok: true, request: number, total, quote: isQuote });
}
