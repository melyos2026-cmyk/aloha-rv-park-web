"use client";
import { useState } from "react";

export default function EventsPage() {
  const [dragging, setDragging] = useState(false);

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--black)", color: "var(--white)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Rec Hall</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Events & Activities</h1>
        <p style={{ fontSize: 16, color: "#9ca3af", maxWidth: 500, margin: "0 auto" }}>
          Stay connected with everything happening at Aloha RV Park.
        </p>
      </section>

      {/* Activities */}
      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>What's Happening</div>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900 }}>Regular Activities</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 24, marginBottom: 60 }}>
            {[
              ["🎱","Bingo Night","Every Friday evening at the Rec Hall. Fun for everyone!"],
              ["⛹️","Shuffleboard","Daily open play. Tournaments every Saturday morning."],
              ["🏊","Pool Hours","Open daily 9AM–9PM. Heated seasonal pool."],
              ["🎮","Game Night","Board games, cards & more every Wednesday evening."],
              ["🌅","Morning Walk","Group walk around the park every weekday at 7AM."],
              ["🎉","Monthly Potluck","Last Sunday of every month. Bring a dish to share!"],
            ].map(([icon, title, desc]) => (
              <div key={title as string} style={{
                background: "var(--white)", border: "2px solid var(--black)",
                borderRadius: 8, padding: 28, transition: "transform 0.2s"
              }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-4px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>{icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>{title as string}</h3>
                <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6 }}>{desc as string}</p>
              </div>
            ))}
          </div>

          {/* Monthly Calendar PDF */}
          <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
            <h2 style={{ fontSize: 28, fontWeight: 900, marginBottom: 12 }}>Monthly Events Calendar</h2>
            <p style={{ fontSize: 15, color: "var(--gray)", marginBottom: 32, maxWidth: 480, margin: "0 auto 32px" }}>
              Download our monthly events calendar to see everything planned for this month at the Rec Hall.
            </p>

            {/* PDF Display Area */}
            <div style={{
              border: "2px dashed var(--border)", borderRadius: 8,
              padding: "60px 24px", marginBottom: 24,
              background: "var(--cream)"
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No calendar uploaded yet</div>
              <div style={{ fontSize: 13, color: "var(--gray)" }}>Check back soon or contact the office for this month's schedule.</div>
            </div>

            <a href="tel:6892520567" style={{
              display: "inline-block", background: "var(--black)", color: "var(--white)",
              padding: "14px 32px", borderRadius: 4, fontWeight: 700, fontSize: 14
            }}>
              📞 Call for Schedule
            </a>
          </div>
        </div>
      </section>

      {/* Rec Hall Info */}
      <section style={{ padding: "60px 24px", background: "var(--black)", color: "var(--white)" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900, marginBottom: 16 }}>Rec Hall</h2>
          <p style={{ fontSize: 16, color: "#9ca3af", lineHeight: 1.8, marginBottom: 32 }}>
            Our Recreation Hall is the heart of the community at Aloha RV Park. 
            Available for resident events, activities, and community gatherings.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="tel:6892520567" style={{ background: "var(--red)", color: "var(--white)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14 }}>
              📞 Contact Office
            </a>
            <a href="mailto:info@aloharvparkfl.com" style={{ background: "transparent", color: "var(--white)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14, border: "2px solid var(--white)" }}>
              ✉️ Email Us
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
