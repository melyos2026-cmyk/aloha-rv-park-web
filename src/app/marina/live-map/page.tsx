import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadPublicSlips } from "@/lib/marina/data";
import SlipBoard from "@/components/marina/SlipBoard";

// Oct 21 (per Mely): just the live interactive slip map (same one boaters use), so the
// marina admin can show it inside Slips & Rates → Map picture. No header, footer or chat.
export const dynamic = "force-dynamic";
export const metadata = { title: "Live slip map", robots: { index: false } };

export default async function MarinaLiveMapPage() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const slips = await loadPublicSlips(company.id);
  return (
    <>
      <style>{`.mr-header,.mr-footer,.mr-demobar,.mr-chat-tip,.mr-chat-fab,.mr-chat{display:none!important} body{background:#fff}`}</style>
      <div className="mr-wrap" style={{ padding: "12px 12px 24px" }}>
        <SlipBoard slips={slips} />
      </div>
    </>
  );
}
