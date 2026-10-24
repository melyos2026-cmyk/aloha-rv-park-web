import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadRestaurant, restaurantEnabled } from "@/lib/restaurant";
import MarinaRestaurant from "@/components/marina/MarinaRestaurant";

// Oct 24 (per Mely): Restaurant — menu, hours, delivery (Uber Eats / DoorDash / Grubhub), reserve a table.
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const company = await getMarinaForPage();
  if (!company) return { title: "Restaurant" };
  const r = await loadRestaurant(company.id, company.company_name);
  return { title: `${r.name} · ${company.company_name}`, description: r.tagline || r.description || "Menu, hours and reservations." };
}
export default async function Page() {
  const company = await getMarinaForPage();
  if (!company || !(await restaurantEnabled(company.id))) notFound();
  const r = await loadRestaurant(company.id, company.company_name);
  return <MarinaRestaurant r={r} marina={company.company_name} />;
}
