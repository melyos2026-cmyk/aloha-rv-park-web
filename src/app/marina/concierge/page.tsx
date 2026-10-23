import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadServices, loadConciergeSettings, moduleOn } from "@/lib/concierge";
import MarinaConcierge from "@/components/marina/MarinaConcierge";

// Oct 23 (per Mely): Concierge — ice, provisions, catering, boat cleaning, crew for a trip.
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const company = await getMarinaForPage();
  if (!company) return { title: "Concierge" };
  const s = await loadConciergeSettings(company.id);
  return { title: `${s.title} · ${company.company_name}`, description: s.intro };
}
export default async function Page() {
  const company = await getMarinaForPage();
  if (!company || !(await moduleOn(company.id, "concierge"))) notFound();
  const [settings, services] = await Promise.all([loadConciergeSettings(company.id), loadServices(company.id)]);
  return <MarinaConcierge title={settings.title} intro={settings.intro} services={services} taxRate={settings.taxRate} phone={company.contact_phone} />;
}
