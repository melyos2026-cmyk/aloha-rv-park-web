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

// Oct 24 (per Mely): the category and sub-category live in the address (?cat=Groceries&sub=Bakery), so a
// refresh or a shared link opens right where the customer was — no flash of another category.
export default async function MarinaStorePage({ searchParams }: { searchParams: Promise<{ cat?: string; sub?: string }> }) {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const sp = await searchParams;
  const [settings, cats] = await Promise.all([loadStoreSettings(company.id), storeCategories(company.id)]);
  const c = cats.find((x) => x.name === sp.cat) || cats[0];
  const sub = c?.subs?.length ? (c.subs.find((x) => x.name === sp.sub) || c.subs[0]).name : "";
  const first = await searchStoreItems(company.id, c ? { category: c.name, subcategory: sub || undefined } : {});
  return <MarinaStore name={settings.name} tagline={settings.tagline} categories={cats} initial={first} initialCat={c?.name || "All"} initialSub={sub} />;
}
