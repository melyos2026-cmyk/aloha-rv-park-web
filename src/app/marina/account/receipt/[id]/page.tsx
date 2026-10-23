import { notFound, redirect } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { currentBoater, loadMarinaDoc } from "@/lib/marina/documents";
import MarinaDocView from "@/components/marina/MarinaDocView";

// Oct 23 (per Mely): printable receipt for the signed-in boater (only their own).
export const dynamic = "force-dynamic";
export const metadata = { title: "Receipt", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getMarinaForPage();
  if (!company) notFound();
  const memberId = await currentBoater(company.id);
  if (!memberId) redirect("/marina/account");
  const doc = await loadMarinaDoc(company.id, memberId, { paymentId: id });
  if (!doc) notFound();
  return <MarinaDocView doc={doc} company={company} />;
}
