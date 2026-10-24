import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { moduleOn } from "@/lib/concierge";
import { loadCareersSettings } from "@/lib/careers";
import { isDemoCompany } from "@/lib/marina/host";
import MarinaCareers from "@/components/marina/MarinaCareers";

// Oct 23 (per Mely): Careers & Crew — apply and upload a license; background checks are run and paid by the marina if it wants them.
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const company = await getMarinaForPage();
  if (!company) return { title: "Careers" };
  const s = await loadCareersSettings(company.id);
  return { title: `${s.title} · ${company.company_name}`, description: s.intro };
}
export default async function Page() {
  const company = await getMarinaForPage();
  if (!company || !(await moduleOn(company.id, "careers"))) notFound();
  const s = await loadCareersSettings(company.id);
  return <MarinaCareers title={s.title} intro={s.intro} roles={s.roles} bgcFee={s.bgcFee} requireBgc={s.requireBgc} marina={company.company_name} demo={isDemoCompany(company)} />;
}
