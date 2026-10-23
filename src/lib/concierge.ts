import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Service } from "@/lib/concierge-shared";
export type { Service } from "@/lib/concierge-shared";
export { priceLabel } from "@/lib/concierge-shared";

// Oct 23 (per Mely): Concierge & Requests — shared helpers.
export const toService = (r: any): Service => ({ id: r.id, category: r.category || "Other", name: r.name, description: r.description || null, photo: r.photo_url || null, pricing: r.pricing || "fixed", price: r.price == null ? null : Number(r.price), unit_label: r.unit_label || null, min_units: Number(r.min_units || 1), taxable: r.taxable !== false, lead_hours: Number(r.lead_hours || 0), requires_crew: !!r.requires_crew, featured: !!r.featured, option_label: (r.option_label || "").trim() || null, options: String(r.options || "").split(",").map((x: string) => x.trim()).filter(Boolean).slice(0, 40) });

export async function moduleOn(companyId: string, name: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("company_modules").select("enabled").eq("company_id", companyId).eq("module_name", name).maybeSingle();
  return !!data?.enabled;
}
export async function loadServices(companyId: string): Promise<Service[]> {
  const { data, error } = await supabaseAdmin.from("concierge_services").select("*").eq("company_id", companyId).eq("active", true).order("sort").order("name");
  return error ? [] : (data || []).map(toService);
}
export async function loadConciergeSettings(companyId: string) {
  const { data } = await supabaseAdmin.from("concierge_settings").select("*").eq("company_id", companyId).maybeSingle();
  return { title: (data?.page_title || "").trim() || "Concierge", intro: (data?.page_intro || "").trim() || "Tell us what you need and when. We bring it to your slip or have it ready at the dock.", taxRate: Number(data?.tax_rate || 0) };
}
