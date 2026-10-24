import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { startInvoicePayment } from "@/lib/marina/checkout";
import { round2, todayET } from "@/lib/marina/data";
import { loadRentalSettings, rentalsEnabled, toItem, unitsFree, priceRental, localIso, to24, dayName, bookingNumber } from "@/lib/rentals";
import crypto from "crypto";
import { accountChargesAllowed } from "@/lib/marina/payPolicy";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

// Oct 23 (per Mely): Rentals & Experiences on the marina website.
// GET ?item=&date=        → free units/seats for that item on that date (per hour / per departure)
// GET ?mine=1             → the signed-in boater's bookings
// POST                    → book: { item, date, start, hours | departure, units, people, name, email, phone, payment, waiverName, notes }
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const u = new URL(req.url).searchParams;
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;

  if (u.get("mine") === "1") {
    if (!memberId) return NextResponse.json({ bookings: [] });
    const { data } = await supabaseAdmin.from("rental_bookings").select("id, booking_number, starts_at, ends_at, units, people, total, deposit, payment, status, rental_items(name, category, kind)")
      .eq("company_id", company.id).eq("member_id", memberId).order("starts_at", { ascending: false }).limit(20);
    return NextResponse.json({ bookings: (data || []).map((b: any) => ({ ...b, item: b.rental_items?.name, category: b.rental_items?.category, kind: b.rental_items?.kind, rental_items: undefined })) });
  }

  const itemId = u.get("item"); const date = u.get("date") || "";
  if (!itemId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "item and date are required." }, { status: 400 });
  const { data: row } = await supabaseAdmin.from("rental_items").select("*").eq("id", itemId).eq("company_id", company.id).eq("active", true).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const item = toItem(row);
  if (!item.days_available.includes(dayName(date))) return NextResponse.json({ item, closed: true, slots: [] });
  if (item.kind === "experience") {
    const slots = await Promise.all(item.departures.map(async (dep) => {
      const start = localIso(date, to24(dep));
      const end = new Date(new Date(start).getTime() + (item.duration_minutes || 120) * 60000).toISOString();
      return { time: dep, free: await unitsFree(item, start, end) };
    }));
    return NextResponse.json({ item, slots });
  }
  // Rentals: free units for each start hour between open and close.
  const [oh] = item.open_time.split(":").map(Number); const [ch] = item.close_time.split(":").map(Number);
  const slots = [];
  for (let h = oh; h + item.min_hours <= ch; h++) {
    const hh = `${String(h).padStart(2, "0")}:00`;
    const start = localIso(date, hh); const end = localIso(date, `${String(h + item.min_hours).padStart(2, "0")}:00`);
    slots.push({ time: hh, free: await unitsFree(item, start, end) });
  }
  return NextResponse.json({ item, slots });
}

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await rentalsEnabled(company.id))) return NextResponse.json({ error: "Online booking is not available right now. Please call the office." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  const settings = await loadRentalSettings(company.id);
  // Oct 24 (security run): flood guards — per marina and per device.
  const { count: lastHour } = await supabaseAdmin.from("rental_bookings").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((lastHour || 0) >= 80) return NextResponse.json({ error: "Too many bookings right now. Please call the office." }, { status: 429 });
  if (await tooManyFromIp(req, `rentals:${company.id}`, 8)) return NextResponse.json({ error: "Too many bookings from this device. Please call the office." }, { status: 429 });

  const { data: row } = await supabaseAdmin.from("rental_items").select("*").eq("id", String(b.item || "")).eq("company_id", company.id).eq("active", true).maybeSingle();
  if (!row) return NextResponse.json({ error: "That item is no longer available." }, { status: 404 });
  const item = toItem(row);
  const date = String(b.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayET()) return NextResponse.json({ error: "Choose a date starting today." }, { status: 400 });
  if (!item.days_available.includes(dayName(date))) return NextResponse.json({ error: "Not available on that day." }, { status: 400 });
  const units = Math.max(1, Math.min(20, Math.round(Number(b.units) || 1)));
  const people = b.people ? Math.max(1, Math.min(200, Math.round(Number(b.people)))) : null;

  let startsAt: string, endsAt: string, basis: string, subtotal: number, units_booked = units;
  if (item.kind === "experience") {
    const dep = String(b.departure || "");
    if (!item.departures.includes(dep)) return NextResponse.json({ error: "Choose a departure time." }, { status: 400 });
    startsAt = localIso(date, to24(dep)); endsAt = new Date(new Date(startsAt).getTime() + (item.duration_minutes || 120) * 60000).toISOString();
    if (item.price_person == null) return NextResponse.json({ error: "Call the office to book this." }, { status: 400 });
    units_booked = people || units; basis = "person"; subtotal = round2(item.price_person * units_booked);
  } else {
    const start = to24(String(b.start || "")); const hours = Math.max(item.min_hours, Math.min(24 * 30, Math.round(Number(b.hours) || item.min_hours)));
    if (!/^\d{2}:\d{2}$/.test(start)) return NextResponse.json({ error: "Choose a start time." }, { status: 400 });
    startsAt = localIso(date, start); endsAt = new Date(new Date(startsAt).getTime() + hours * 3600000).toISOString();
    const p = priceRental(item, hours);
    if (!p) return NextResponse.json({ error: "Call the office to book this." }, { status: 400 });
    basis = p.basis; subtotal = round2(p.subtotal * units);
  }
  const free = await unitsFree(item, startsAt, endsAt);
  if (free < units_booked) return NextResponse.json({ error: free <= 0 ? "Sorry, that time is fully booked. Try another time." : `Only ${free} available at that time.` }, { status: 409 });

  // Customer + waiver
  let name = text(b.name, 120), email = text(b.email, 160).toLowerCase(), phone = text(b.phone, 40);
  if (memberId) {
    const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", memberId).eq("company_id", company.id).maybeSingle();
    name = name || m?.full_name || ""; email = email || (m?.email || "").toLowerCase(); phone = phone || m?.phone || "";
  }
  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  const waiverName = text(b.waiverName, 120);
  if (item.waiver_text && !waiverName) return NextResponse.json({ error: "Please type your full name to sign the rental agreement." }, { status: 400 });
  // Oct 24 (per Mely): charge to account only where the marina allows it; otherwise pay now.
  const payment = b.payment === "account" && memberId && (await accountChargesAllowed(company.id)) ? "account" : "card";

  const tax = item.taxable ? round2(subtotal * settings.taxRate / 100) : 0;
  const deposit = round2(item.deposit * (item.kind === "experience" ? 1 : units));
  const total = round2(subtotal + tax + deposit);
  const number = bookingNumber();
  const when = `${new Date(startsAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  const desc = `${item.name} · ${when}${item.kind === "experience" ? ` · ${units_booked} ${units_booked === 1 ? "person" : "people"}` : units > 1 ? ` · ${units} units` : ""}${deposit ? ` (incl. $${deposit.toFixed(2)} refundable deposit)` : ""}`.slice(0, 300);

  // Invoice (marina) so payments/receipts/statements work as everywhere else.
  let invoice: { id: string } | null = null;
  const today = todayET();
  for (let i = 0; i < 5 && !invoice; i++) {
    const inv = `WEB-${today.replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from("marina_invoices").insert({
      company_id: company.id, invoice_number: inv, category: "other", member_id: memberId, customer_name: name, customer_email: email,
      description: `Rental ${number}: ${desc}`, amount: total, issue_date: today, due_date: payment === "account" ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : today,
    }).select("id").single();
    if (data) invoice = data; else if (error?.code !== "23505") return NextResponse.json({ error: "Could not create the booking. Please try again." }, { status: 500 });
  }
  if (!invoice) return NextResponse.json({ error: "Could not create the booking. Please try again." }, { status: 500 });

  const { data: booking, error: bErr } = await supabaseAdmin.from("rental_bookings").insert({
    company_id: company.id, item_id: item.id, booking_number: number, member_id: memberId, invoice_id: invoice.id,
    customer_name: name, customer_email: email, customer_phone: phone || null, starts_at: startsAt, ends_at: endsAt,
    units: units_booked, people, price_basis: basis, subtotal, tax, deposit, total, payment,
    status: settings.autoConfirm ? "confirmed" : "requested", waiver_signed_at: waiverName ? new Date().toISOString() : null, waiver_name: waiverName || null,
    notes: text(b.notes, 500) || null,
  }).select("id").single();
  if (bErr || !booking) {
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Rental booking could not be saved" }).eq("id", invoice.id).eq("company_id", company.id);
    return NextResponse.json({ error: "Could not create the booking. Please try again." }, { status: 500 });
  }
  // Oct 24 (security run): the office hears about a card booking once it's paid (rentalPaidForInvoice).
  if (payment === "account") await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "rental_booking",
    message: `New booking ${number}: ${desc} — $${total.toFixed(2)} (charged to account).`,
  }).then(() => null, () => null);

  if (payment === "account") return NextResponse.json({ ok: true, booking: number, total, charged: true });
  const origin = `https://${company.domain}`;
  const pay = await startInvoicePayment({ company, invoiceId: invoice.id, memberId, successUrl: `${origin}/marina/rentals?booked=${number}`, cancelUrl: `${origin}/marina/rentals?cancelled=${number}` });
  if (!pay.ok) {
    await supabaseAdmin.from("rental_bookings").update({ status: "cancelled", status_by_name: "Payment could not start" }).eq("id", booking.id);
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Payment could not be started" }).eq("id", invoice.id).eq("company_id", company.id);
    return NextResponse.json({ error: pay.error }, { status: pay.status });
  }
  return NextResponse.json("url" in pay ? { url: pay.url, booking: number, total } : { ok: true, demo: true, booking: number, total });
}
