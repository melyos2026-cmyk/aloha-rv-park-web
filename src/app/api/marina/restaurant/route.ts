import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { loadRestaurant, restaurantEnabled } from "@/lib/restaurant";
import { dayName, timeSlots } from "@/lib/restaurant-shared";
import { localIso } from "@/lib/rentals";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

// Oct 24 (per Mely): table reservations. GET ?mine=1 → the boater's reservations. POST → reserve.
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  if (!memberId) return NextResponse.json({ reservations: [], signedIn: false });
  const { data } = await supabaseAdmin.from("restaurant_reservations").select("id, reservation_number, reserved_at, party_size, status, notes").eq("company_id", company.id).eq("member_id", memberId).order("reserved_at", { ascending: false }).limit(20);
  return NextResponse.json({ reservations: data || [], signedIn: true });
}

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await restaurantEnabled(company.id))) return NextResponse.json({ error: "Reservations are not available online right now." }, { status: 400 });
  const r = await loadRestaurant(company.id, company.company_name);
  if (!r.reservations_on) return NextResponse.json({ error: `Please call ${r.phone || "the restaurant"} to reserve.` }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;

  const date = text(b.date, 10), time = text(b.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !timeSlots(r).includes(time)) return NextResponse.json({ error: "Choose a date and a time." }, { status: 400 });
  const when = new Date(localIso(date, time));
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Choose a date and a time." }, { status: 400 });
  if (r.closed_days.includes(dayName(new Date(date + "T12:00:00")))) return NextResponse.json({ error: `We're closed on ${dayName(new Date(date + "T12:00:00"))}s.` }, { status: 400 });
  if (when.getTime() < Date.now() + r.lead_hours * 3600 * 1000) return NextResponse.json({ error: r.lead_hours >= 1 ? `Please reserve at least ${r.lead_hours} hour${r.lead_hours === 1 ? "" : "s"} ahead, or call ${r.phone || "us"}.` : "That time has passed." }, { status: 400 });
  const party = Math.round(Number(b.party) || 0);
  if (party < 1) return NextResponse.json({ error: "How many people?" }, { status: 400 });
  if (party > r.max_party) return NextResponse.json({ error: `For parties over ${r.max_party}, please call ${r.phone || "the restaurant"}.` }, { status: 400 });

  let name = text(b.name, 120), email = text(b.email, 160).toLowerCase(), phone = text(b.phone, 40);
  if (memberId) {
    const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", memberId).eq("company_id", company.id).maybeSingle();
    name = name || m?.full_name || ""; email = email || (m?.email || "").toLowerCase(); phone = phone || m?.phone || "";
  }
  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!phone && !email) return NextResponse.json({ error: "Please enter a phone or email so we can confirm." }, { status: 400 });
  if (email && !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });

  const { count } = await supabaseAdmin.from("restaurant_reservations").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((count || 0) >= 60) return NextResponse.json({ error: "Too many requests right now. Please call the restaurant." }, { status: 429 });
  if (await tooManyFromIp(req, `restaurant:${company.id}`, 6)) return NextResponse.json({ error: "Too many requests from this device. Please call the restaurant." }, { status: 429 });

  const number = `RT-${date.slice(2).replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const status = r.auto_confirm ? "confirmed" : "requested";
  const { error } = await supabaseAdmin.from("restaurant_reservations").insert({
    company_id: company.id, reservation_number: number, member_id: memberId, customer_name: name, customer_email: email || null, customer_phone: phone || null,
    party_size: party, reserved_at: when.toISOString(), notes: text(b.notes, 500) || null, status, source: "website",
  });
  if (error) return NextResponse.json({ error: "Could not save your reservation. Please try again." }, { status: 500 });
  const whenTxt = when.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: name, update_type: "restaurant_reservation", message: `${r.name}: table for ${party} on ${whenTxt} (${number})${status === "requested" ? " — needs confirmation" : ""}.` }).then(() => null, () => null);
  return NextResponse.json({ ok: true, number, status, when: whenTxt });
}
