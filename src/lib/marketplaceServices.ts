// Oct 29 (per Mely): "Services" category on the RV-park resident Marketplace — residents offering
// services to neighbors in the park (sewing, babysitting, dog walking…). Values are stored in
// English (marketplace_listings.category / subcategory / price_unit) and translated in the portal
// (src/lib/portalI18n.ts). subcategory + price_unit columns: marketplace_services.sql (SQL Editor) — until
// it runs, a Services listing still saves (without those two fields). Client-safe (no server imports).

export const SERVICES_CATEGORY = "Services";

export const SERVICE_SUBCATEGORIES = [
  "Sewing & alterations",
  "Beauty & hair",
  "Elder care / companion",
  "Pet care & dog walking",
  "Babysitting",
  "Cleaning",
  "Handyman & repairs",
  "Tutoring & lessons",
  "Cooking & meals",
  "Other services",
] as const;

export const SERVICE_PRICE_UNITS = ["per_hour", "per_visit", "per_service", "ask"] as const;
export type ServicePriceUnit = (typeof SERVICE_PRICE_UNITS)[number];

/** English label of each unit (the portal translates it with t()). */
export const SERVICE_PRICE_UNIT_LABELS: Record<ServicePriceUnit, string> = {
  per_hour: "per hour",
  per_visit: "per visit",
  per_service: "per service",
  ask: "Ask for price",
};

export const SERVICES_NOTE = "Arrange services directly with the neighbor. The park is not responsible for services between residents.";

export function isServicesCategory(category: unknown): boolean {
  return String(category ?? "").trim() === SERVICES_CATEGORY;
}

/** Clean what the browser sent: Services → a known subcategory + unit; anything else → nulls. */
export function normalizeServiceFields(category: unknown, subcategory: unknown, priceUnit: unknown): { subcategory: string | null; price_unit: ServicePriceUnit | null } {
  if (!isServicesCategory(category)) return { subcategory: null, price_unit: null };
  const sub = (SERVICE_SUBCATEGORIES as readonly string[]).includes(String(subcategory ?? "")) ? String(subcategory) : "Other services";
  const unit = (SERVICE_PRICE_UNITS as readonly string[]).includes(String(priceUnit ?? "")) ? (String(priceUnit) as ServicePriceUnit) : "ask";
  return { subcategory: sub, price_unit: unit };
}

/**
 * Price text of a Services listing, in English pieces the caller translates:
 * no price or "ask" → { amount: null, unit: "Ask for price" }; otherwise the amount + "per hour"…
 */
export function servicePriceParts(price: number | null | undefined, priceUnit: unknown): { amount: number | null; unit: string } {
  const unit = (SERVICE_PRICE_UNITS as readonly string[]).includes(String(priceUnit ?? "")) ? (String(priceUnit) as ServicePriceUnit) : null;
  if (price == null || unit === "ask") return { amount: null, unit: SERVICE_PRICE_UNIT_LABELS.ask };
  return { amount: Number(price), unit: unit ? SERVICE_PRICE_UNIT_LABELS[unit] : "" };
}
