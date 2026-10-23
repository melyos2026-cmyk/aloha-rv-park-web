import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadRentalItems, loadRentalSettings, rentalsEnabled } from "@/lib/rentals";
import MarinaRentals from "@/components/marina/MarinaRentals";

// Oct 23 (per Mely): Rentals & Experiences page — golf carts, boats, kayaks, tours, airboat
// rides, restaurant… whatever this marina offers, booked and paid online.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const company = await getMarinaForPage();
  if (!company) return { title: "Rentals" };
  const s = await loadRentalSettings(company.id);
  return { title: `${s.title} · ${company.company_name}`, description: s.intro };
}

export default async function Page() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const enabled = await rentalsEnabled(company.id);
  if (!enabled) notFound();
  const [settings, items] = await Promise.all([loadRentalSettings(company.id), loadRentalItems(company.id)]);
  return <MarinaRentals title={settings.title} intro={settings.intro} items={items} taxRate={settings.taxRate} phone={company.contact_phone} />;
}
