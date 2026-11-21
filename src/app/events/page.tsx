"use client";
import { useEffect, useState } from "react";
import { useCompany } from "@/lib/CompanyContext";
import PdfCalendarViewer from "@/components/PdfCalendarViewer";

export default function EventsPage() {
  const { company } = useCompany();
  const parkName = company?.company_name || "Aloha RV Park";
  const contactEmail = company?.contact_email || "info@aloharvparkfl.com";
  const contactPhone = company?.contact_phone || "(689) 252-0567";
  const phoneHref = `tel:${contactPhone.replace(/[^\d]/g, "")}`;
  // Oct 29 (per Mely): follow the admin's Rec Hall switch (park_settings.lease_defaults.clubhouse_enabled,
  // read through /api/get-enabled-modules). null = still loading → keep it hidden so it never flashes.
  const [recHallOn, setRecHallOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!company?.id) return;
    let alive = true;
    fetch(`/api/get-enabled-modules?company_id=${company.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (alive) setRecHallOn(d?.recHall !== false); })
      .catch(() => { if (alive) setRecHallOn(true); });
    return () => { alive = false; };
  }, [company?.id]);

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--sea)", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--black)", fontWeight: 600, marginBottom: 12 }}>{recHallOn !== false ? "Rec Hall" : "Community"}</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Events & Activities</h1>
        <p style={{ fontSize: 16, color: "#4b5563", maxWidth: 500, margin: "0 auto" }}>
          Stay connected with everything happening at {parkName}.
        </p>
      </section>

      {/* Activities */}
      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1600, margin: "0 auto" }}>
          <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
            <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12 }}>Monthly Events Calendar</h2>
            <p style={{ fontSize: 15, color: "var(--gray)", marginBottom: 32, maxWidth: 480, margin: "0 auto 32px" }}>
              Download our monthly events calendar to see everything planned for this month{recHallOn !== false ? " at the Rec Hall" : ""}.
            </p>

            {company?.events_calendar_pdf_url ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16, background: "var(--cream)" }}>
                  {/* Nov 21 (per Mely): an image calendar (PNG/JPG) shows big, like the marina demo; a PDF uses the viewer */}
                  {/\.pdf($|\?)/i.test(company.events_calendar_pdf_url)
                    ? <PdfCalendarViewer pdfUrl={company.events_calendar_pdf_url} />
                    : <a href={company.events_calendar_pdf_url} target="_blank" rel="noopener noreferrer"><img src={company.events_calendar_pdf_url} alt={`${parkName} events calendar`} style={{ display: "block", width: "100%", height: "auto", borderRadius: 6 }} /></a>}
                </div>
                {!/\.pdf($|\?)/i.test(company.events_calendar_pdf_url) && (
                  <button type="button" onClick={() => {
                    const u = company.events_calendar_pdf_url as string, w = window.open("", "_blank");
                    if (!w) return;
                    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Events calendar</title><style>@page{size:landscape;margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img src="${u.replace(/"/g, "&quot;")}" onload="setTimeout(function(){window.print()},150)" alt="Events calendar"/></body></html>`);
                    w.document.close();
                  }} style={{ display: "inline-block", marginTop: 16, marginRight: 10, background: "var(--white)", color: "var(--black)", padding: "12px 24px", borderRadius: 6, fontWeight: 700, fontSize: 14, border: "2px solid var(--black)", cursor: "pointer" }}>
                    🖨️ Print calendar
                  </button>
                )}
                <a
                  href={company.events_calendar_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block", marginTop: 16,
                    background: "var(--black)", color: "#fff",
                    padding: "12px 24px", borderRadius: 6, fontWeight: 700, fontSize: 14,
                    textDecoration: "none"
                  }}
                >
                  {/\.pdf($|\?)/i.test(company.events_calendar_pdf_url) ? "📄 Download PDF" : "⬇️ Download"}
                </a>
              </div>
            ) : (
              <div style={{
                border: "2px dashed var(--border)", borderRadius: 8,
                padding: "60px 24px", marginBottom: 24,
                background: "var(--cream)"
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No calendar uploaded yet</div>
                <div style={{ fontSize: 13, color: "var(--gray)" }}>Check back soon or contact the office for this month's schedule.</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Rec Hall Info — only while the admin's Rec Hall switch is on */}
      {recHallOn && <section style={{ padding: "60px 24px", background: "#f6f5f5", color: "var(--black)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900, marginBottom: 16 }}>Rec Hall</h2>
          <p style={{ fontSize: 16, color: "#4b5563", lineHeight: 1.8, marginBottom: 16 }}>
            Our Recreation Hall is the heart of the community at {parkName}. 
            Available for resident events, activities, and community gatherings.
          </p>
          <p style={{ fontSize: 15, color: "#4b5563", lineHeight: 1.8, marginBottom: 32, fontWeight: 600 }}>
            Interested in renting the Rec Hall for a private event? Contact our office to check availability and pricing.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={phoneHref} style={{ background: "var(--mint)", color: "var(--red-dark)", border: "2px solid var(--red-dark)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14 }}>
              📞 Contact Office
            </a>
            <a href={`mailto:${contactEmail}`} style={{ background: "transparent", color: "var(--black)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14, border: "2px solid var(--black)" }}>
              ✉️ Email Us
            </a>
          </div>
        </div>
      </section>}
    </>
  );
}
