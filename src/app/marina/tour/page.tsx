import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { isDemoDomain } from "@/lib/marina/host";
import TourScreens from "@/components/marina/TourScreens";

// Oct 21 (per Mely): "Tour of the office" for the marina demo — prospects who get the
// demo link can see the admin screens without an account. Only on demo marinas.
export const dynamic = "force-dynamic";
export const metadata = { title: "Office tour — MelyOS for marinas" };

export default async function MarinaTourPage() {
  const company = await getMarinaForPage();
  if (!company || !isDemoDomain(company.domain)) notFound();
  return <TourScreens marinaName={company.company_name} />;
}
