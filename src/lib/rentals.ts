import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { round2 } from "@/lib/marina/data";

// Oct 23 (per Mely): Rentals & Experiences — golf carts, boats, kayaks, jet skis, bikes, tours,
// charters, airboat rides, restaurant tables. Shared by the website pages and the booking API.
// Prices and availability are always computed here from the database, never trusted from
// the browser.

export type RentalItem = {
  id: string; kind: "rental" | "experience"; category: string; name: string; description: string | null; photo: string | null;
  price_hour: number | null; price_day: number | null; price_week: number | null; price_person: number | null;
  deposit: number; taxable: boolean; quantity: number; min_hours: number; open_time: string; close_time: string;
  departures: string[]; duration_minutes: number | null; days_available: string[];
  min_age: number | null; requires_license: boolean; waiver_text: string | null; capacity: number | null; featured: boolean;
};
export const CATEGORIES = ["Golf carts", "Boats", "Kayaks & paddleboards", "Jet skis", "Bikes", "Event room", "Tours", "Fishing charters", "Airboat rides", "Restaurant", "Other"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toItem(r: any): RentalItem {
  return {
    id: r.id, kind: r.kind === "experience" ? "experience" : "rental", category: r.category || "Other", name: r.name, description: r.description || null, photo: r.photo_url || null,
    price_hour: r.price_hour == null ? null : Number(r.price_hour), price_day: r.price_day == null ? null : Number(r.price_day),
    price_week: r.price_week == null ? null : Number(r.price_week), price_person: r.price_person == null ? null : Number(r.price_person),
    deposit: Number(r.deposit || 0), taxable: r.taxable !== false, quantity: Number(r.quantity || 1), min_hours: Number(r.min_hours || 1),
    open_time: r.open_time || "08:00", close_time: r.close_time || "18:00",
    departures: String(r.departures || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    duration_minutes: r.duration_minutes == null ? null : Number(r.duration_minutes),
    days_available: String(r.days_available || "Mon,Tue,Wed,Thu,Fri,Sat,Sun").split(",").map((s: string) => s.trim()).filter(Boolean),
    min_age: r.min_age == null ? null : Number(r.min_age), requires_license: !!r.requires_license, waiver_text: r.waiver_text || null,
    capacity: r.capacity == null ? null : Number(r.capacity), featured: !!r.featured,
  };
}

export async function rentalsEnabled(companyId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("company_modules").select("enabled").eq("company_id", companyId).eq("module_name", "rentals").maybeSingle();
  return !!data?.enabled;
}

export async function loadRentalItems(companyId: string): Promise<RentalItem[]> {
  const { data, error } = await supabaseAdmin.from("rental_items").select("*").eq("company_id", companyId).eq("active", true).order("sort").order("name");
  if (error) return [];
  return (data || []).map(toItem);
}

export async function loadRentalSettings(companyId: string) {
  const { data } = await supabaseAdmin.from("rental_settings").select("*").eq("company_id", companyId).maybeSingle();
  return { title: (data?.page_title || "").trim() || "Rentals & Experiences", intro: (data?.page_intro || "").trim() || "Book golf carts, boats, kayaks, tours and more — pay online and it's ready when you arrive.", taxRate: Number(data?.tax_rate || 0), autoConfirm: data?.auto_confirm !== false };
}

// "09:00" on a date (America/New_York) → ISO. Keeps it simple: the property's local clock.
export function localIso(date: string, hhmm: string): string {
  // Florida offset: EDT (-04) Mar–Nov, EST (-05) otherwise, by second-Sunday/first-Sunday rule.
  const [y, m, d] = date.split("-").map(Number);
  const dow = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
  const nthSunday = (yy: number, mm: number, n: number) => { const first = 1 + ((7 - dow(yy, mm, 1)) % 7); return first + 7 * (n - 1); };
  const dstStart = Date.UTC(y, 2, nthSunday(y, 3, 2), 7);      // 2 AM EST = 07:00 UTC
  const dstEnd = Date.UTC(y, 10, nthSunday(y, 11, 1), 6);      // 2 AM EDT = 06:00 UTC
  const [hh, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mi);
  const offset = guess >= dstStart && guess < dstEnd ? 4 : 5;
  return new Date(guess + offset * 3600 * 1000).toISOString();
}
export const to12 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`; };
export const to24 = (s: string) => { const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/); if (!m) return s.trim(); let h = Number(m[1]); const mi = m[2] || "00"; const ap = (m[3] || "").toUpperCase(); if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0; return `${String(h).padStart(2, "0")}:${mi}`; };

export function dayName(date: string) { return DAYS[new Date(date + "T12:00:00").getUTCDay()]; }

// How many units are still free for an item in a time window.
export async function unitsFree(item: RentalItem, startsIso: string, endsIso: string): Promise<number> {
  const { data } = await supabaseAdmin.from("rental_bookings").select("units")
    .eq("item_id", item.id).in("status", ["requested", "confirmed", "checked_out"]).lt("starts_at", endsIso).gt("ends_at", startsIso);
  const used = (data || []).reduce((a: number, b: any) => a + Number(b.units || 1), 0);
  return Math.max(0, item.quantity - used);
}

// Price for a rental window (hours, days or weeks — the cheapest basis that fits).
export function priceRental(item: RentalItem, hours: number): { basis: string; subtotal: number } | null {
  const h = Math.max(hours, item.min_hours);
  const options: { basis: string; subtotal: number }[] = [];
  if (item.price_hour != null) options.push({ basis: "hour", subtotal: round2(item.price_hour * h) });
  if (item.price_day != null) options.push({ basis: "day", subtotal: round2(item.price_day * Math.max(1, Math.ceil(h / 24))) });
  if (item.price_week != null && h >= 24 * 7) options.push({ basis: "week", subtotal: round2(item.price_week * Math.ceil(h / (24 * 7))) });
  if (!options.length) return null;
  // A day rate applies once the hourly cost passes the day rate.
  return options.sort((a, b) => a.subtotal - b.subtotal)[0];
}

export function bookingNumber() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `RB-${d}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
