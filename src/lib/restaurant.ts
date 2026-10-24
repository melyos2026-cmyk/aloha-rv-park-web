import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Restaurant } from "@/lib/restaurant-shared";
export type { Restaurant } from "@/lib/restaurant-shared";

// Oct 24 (per Mely): Restaurant module — menu, hours, delivery links, table reservations.
export async function restaurantEnabled(companyId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("company_modules").select("enabled").eq("company_id", companyId).eq("module_name", "restaurant").maybeSingle();
  return !!data?.enabled;
}
export function toRestaurant(d: any, fallbackName: string): Restaurant {
  const delivery: Restaurant["delivery"] = [];
  const ok = (u: any) => /^https:\/\//.test(String(u || ""));
  if (ok(d?.ubereats_url)) delivery.push({ label: "Uber Eats", url: d.ubereats_url, brand: "ubereats" });
  if (ok(d?.doordash_url)) delivery.push({ label: "DoorDash", url: d.doordash_url, brand: "doordash" });
  if (ok(d?.grubhub_url)) delivery.push({ label: "Grubhub", url: d.grubhub_url, brand: "grubhub" });
  if (ok(d?.other_delivery_url)) delivery.push({ label: (d.other_delivery_label || "Order online").trim(), url: d.other_delivery_url, brand: "other" });
  return {
    name: (d?.name || "").trim() || `${fallbackName} Restaurant`, tagline: d?.tagline || null, description: d?.description || null, phone: d?.phone || null, hours_text: d?.hours_text || null,
    photo: d?.photo_url || null, menu_photos: Array.isArray(d?.menu_photos) ? d.menu_photos.filter((x: any) => typeof x === "string") : [], menu_pdf: d?.menu_pdf_url || null, delivery,
    reservations_on: d?.reservations_on !== false, auto_confirm: !!d?.auto_confirm, open_time: d?.open_time || "11:00", close_time: d?.close_time || "21:00",
    slot_minutes: Number(d?.slot_minutes || 30), max_party: Number(d?.max_party || 10), lead_hours: Number(d?.lead_hours ?? 1),
    closed_days: String(d?.closed_days || "").split(",").map((x: string) => x.trim()).filter(Boolean),
  };
}
export async function loadRestaurant(companyId: string, fallbackName: string): Promise<Restaurant> {
  const { data } = await supabaseAdmin.from("restaurant_settings").select("*").eq("company_id", companyId).maybeSingle();
  return toRestaurant(data, fallbackName);
}
