"use client";
import { useState } from "react";
import { useCompany } from "@/lib/CompanyContext";

export default function EventsPage() {
  const [dragging, setDragging] = useState(false);
  const { company } = useCompany();
  const contactEmail = company?.contact_email || "info@aloharvparkfl.com";
  const contactPhone = company?.contact_phone || "(689) 252-0567";
  const phoneHref = `tel:${contactPhone.replace(/[^\d]/g, "")}`;

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--sea)", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--black)", fontWeight: 600, marginBottom: 12 }}>Rec Hall</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Events & Activities</h1>
        <p style={{ fontSize: 16, color: "#4b5563", maxWidth: 500, margin: "0 auto" }}>
          Stay connected with everything happening at Aloha RV Park.
        </p>
      </section>

      {/* Activities */}
      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
            <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12 }}>Monthly Events Calendar</h2>
            <p style={{ fontSize: 15, color: "var(--gray)", marginBottom: 32, maxWidth: 480, margin: "0 auto 32px" }}>
              Download our monthly events calendar to see everything planned for this month at the Rec Hall.
            </p>

            <div style={{
              border: "2px dashed var(--border)", borderRadius: 8,
              padding: "60px 24px", marginBottom: 24,
              background: "var(--cream)"
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No calendar uploaded yet</div>
              <div style={{ fontSize: 13, color: "var(--gray)" }}>Check back soon or contact the office for this month's schedule.</div>
            </div>
          </div>
        </div>
      </section>

      {/* Rec Hall Info */}
      <section style={{ padding: "60px 24px", background: "#f6f5f5", color: "var(--black)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900, marginBottom: 16 }}>Rec Hall</h2>
          <p style={{ fontSize: 16, color: "#4b5563", lineHeight: 1.8, marginBottom: 16 }}>
            Our Recreation Hall is the heart of the community at Aloha RV Park. 
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
      </section>
    </>
  );
}
