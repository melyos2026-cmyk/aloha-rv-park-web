import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import AccountClient from "@/components/marina/AccountClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Boater account" };

export default async function MarinaAccountPage() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  return <AccountClient />;
}
