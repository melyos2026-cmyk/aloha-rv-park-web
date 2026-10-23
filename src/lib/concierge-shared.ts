// Oct 23: client-safe pieces of Concierge (no database import — used by the website page).
export type Service = { id: string; category: string; name: string; description: string | null; photo: string | null; pricing: "fixed" | "per_unit" | "per_hour" | "quote"; price: number | null; unit_label: string | null; min_units: number; taxable: boolean; lead_hours: number; requires_crew: boolean; featured: boolean; option_label: string | null; options: string[] };
export function priceLabel(s: Service) {
  if (s.pricing === "quote" || s.price == null) return "Price on request";
  const p = "$" + s.price.toFixed(2);
  return s.pricing === "per_unit" ? `${p} per ${s.unit_label || "unit"}` : s.pricing === "per_hour" ? `${p} per hour` : p;
}
