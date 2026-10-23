import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadStoreSettings, searchStoreItems, storeCategories } from "@/lib/marina/data";
import MarinaStore from "@/components/marina/MarinaStore";

// Oct 23 (per Mely): the marina's store as its own page, like an online shop: categories,
// search, photos, and pages of items so it works with thousands of products.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const company = await getMarinaForPage();
  if (!company) return { title: "Store" };
  const s = await loadStoreSettings(company.id);
  return { title: `${s.name} · ${company.company_name}`, description: s.tagline };
}

export default async function MarinaStorePage() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const [settings, cats, first] = await Promise.all([loadStoreSettings(company.id), storeCategories(company.id), searchStoreItems(company.id, {})]);
  return <MarinaStore name={settings.name} tagline={settings.tagline} categories={cats} initial={first} />;
}
