"use client";
import type { ReactNode } from "react";

// Shared layout for the public Privacy Policy and Terms pages. Same look
// as the rest of the site (sea-colored hero, cream body, white card).
export type LegalSection = { title: string; body: ReactNode };

export default function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  sections,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <>
      <section style={{ background: "var(--sea)", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>{eyebrow}</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 12 }}>{title}</h1>
        <p style={{ fontSize: 14, color: "#4b5563" }}>Last updated: {updated}</p>
      </section>

      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: "40px clamp(20px, 5vw, 48px)" }}>
          <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.8, marginBottom: 32 }}>{intro}</div>
          {sections.map((s, i) => (
            <div key={s.title} style={{ marginBottom: i === sections.length - 1 ? 0 : 28 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 10 }}>{s.title}</h2>
              <div style={{ fontSize: 15, color: "#374151", lineHeight: 1.8 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
