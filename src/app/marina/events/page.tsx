import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import MarinaEventsCalendar from "@/components/marina/MarinaEventsCalendar";

// Oct 24 (per Mely): Events page for marinas — the monthly calendar, big and printable.
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const company = await getMarinaForPage();
  return { title: company ? `Events · ${company.company_name}` : "Events" };
}

export default async function Page() {
  const company = await getMarinaForPage();
  if (!company) notFound();
  const url = company.events_calendar_pdf_url || "";
  return (
    <div className="mr-wrap mr-cal-page">
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>Events &amp; activities</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>What&apos;s happening at {company.company_name} this month — dockside activities, community and on the water.</p>
      {url ? <MarinaEventsCalendar url={url} title={`${company.company_name} events calendar`} /> : (
        <div className="mr-card" style={{ textAlign: "center", padding: 40 }}>
          <h3 style={{ marginTop: 0 }}>No calendar posted yet</h3>
          <p className="mr-note">Check back soon{company.contact_phone ? <> or call <a href={`tel:${company.contact_phone}`}>{company.contact_phone}</a></> : null} for this month&apos;s schedule.</p>
        </div>
      )}
    </div>
  );
}
