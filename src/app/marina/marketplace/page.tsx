import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import MarinaMarketplace from "@/components/marina/MarinaMarketplace";

// Oct 22 (per Mely): the marina's community Marketplace (items posted by boaters).
export const dynamic = "force-dynamic";
export const metadata = { title: "Marketplace" };

export default async function MarinaMarketplacePage() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  return <MarinaMarketplace marinaName={company.company_name} />;
}
