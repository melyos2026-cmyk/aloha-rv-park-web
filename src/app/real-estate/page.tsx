"use client";
import { useState } from "react";

const listings = [
  { id: 1, type: "rent", category: "Mini Home", title: "Cozy 1BR Mini Home", price: "$750/mo", beds: 1, baths: 1, sqft: 400, description: "Charming mini home in a quiet section of the park. Includes water & sewer.", available: true },
  { id: 2, type: "sale", category: "Mini Home", title: "2BR Mini Home for Sale", price: "$45,000", beds: 2, baths: 1, sqft: 600, description: "Well-maintained 2 bedroom mini home. Ready to move in.", available: true },
  { id: 3, type: "rent-to-own", category: "Mini Home", title: "Rent-to-Own Opportunity", price: "$800/mo", beds: 2, baths: 1, sqft: 550, description: "Start renting today with option to purchase. Part of each payment goes toward ownership.", available: true },
  { id: 4, type: "sale", category: "Fixed RV", title: "Fixed RV – Fully Set Up", price: "$18,000", beds: 1, baths: 1, sqft: 300, description: "Fixed RV that cannot be moved. Fully connected to utilities. Great starter option.", available: true },
  { id: 5, type: "sale", category: "Abandoned RV", title: "Abandoned RV – As Is", price: "$5,500", beds: 1, baths: 1, sqft: 250, description: "Sold as-is. Great for renovation or parts. Priced to sell.", available: true },
];

const typeLabels: Record<string, string> = {
  rent: "For Rent",
  sale: "For Sale",
  "rent-to-own": "Rent-to-Own",
};

const typeColors: Record<string, string> = {
  rent: "#16a34a",
  sale: "var(--red)",
  "rent-to-own": "#b45309",
};

export default function RealEstatePage() {
  const [filter, setFilter] = useState("all");

  const filtered = filter === "all" ? listings : listings.filter(l => l.type === filter);

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--black)", color: "var(--white)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Properties</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Real Estate</h1>
        <p style={{ fontSize: 16, color: "#9ca3af", maxWidth: 500, margin: "0 auto" }}>
          Mini homes, fixed RVs, and more. Find your perfect spot at Aloha RV Park.
        </p>
      </section>

      {/* Filter */}
      <section style={{ background: "var(--white)", borderBottom: "2px solid var(--black)", padding: "0 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 0 }}>
          {[["all","All Listings"],["rent","For Rent"],["sale","For Sale"],["rent-to-own","Rent-to-Own"]].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)} style={{
              padding: "18px 24px", fontWeight: 700, fontSize: 13,
              background: "none", border: "none",
              borderBottom: filter === v ? "3px solid var(--red)" : "3px solid transparent",
              color: filter === v ? "var(--red)" : "var(--gray)",
              letterSpacing: "0.03em", cursor: "pointer", textTransform: "uppercase"
            }}>{l}</button>
          ))}
        </div>
      </section>

      {/* Listings */}
      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 28 }}>
            {filtered.map(l => (
              <div key={l.id} style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, overflow: "hidden", transition: "transform 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-4px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}>
                {/* Image placeholder */}
                <div style={{ height: 200, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, position: "relative" }}>
                  🏠
                  <div style={{ position: "absolute", top: 12, left: 12, background: typeColors[l.type], color: "var(--white)", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    {typeLabels[l.type]}
                  </div>
                </div>
                <div style={{ padding: 24 }}>
                  <div style={{ fontSize: 11, color: "var(--gray)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{l.category}</div>
                  <h3 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>{l.title}</h3>
                  <div style={{ fontSize: 24, fontFamily: "Playfair Display, serif", fontWeight: 700, color: typeColors[l.type], marginBottom: 12 }}>{l.price}</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--gray)", marginBottom: 12 }}>
                    <span>🛏 {l.beds} bed</span>
                    <span>🚿 {l.baths} bath</span>
                    <span>📐 {l.sqft} sqft</span>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6, marginBottom: 20 }}>{l.description}</p>
                  <a href={`mailto:info@aloharvparkfl.com?subject=Inquiry: ${l.title}`} style={{
                    display: "block", textAlign: "center",
                    background: "var(--black)", color: "var(--white)",
                    padding: "12px", borderRadius: 6, fontWeight: 700, fontSize: 13,
                    letterSpacing: "0.05em", textTransform: "uppercase"
                  }}>
                    📩 Inquire Now
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Contact CTA */}
          <div style={{ background: "var(--black)", color: "var(--white)", borderRadius: 8, padding: "48px 32px", textAlign: "center", marginTop: 60 }}>
            <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 12 }}>Don't see what you're looking for?</h2>
            <p style={{ color: "#9ca3af", marginBottom: 28, fontSize: 15 }}>Contact our office — new properties become available regularly.</p>
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <a href="tel:6892520567" style={{ background: "var(--red)", color: "var(--white)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14 }}>
                📞 (689) 252-0567
              </a>
              <a href="mailto:info@aloharvparkfl.com" style={{ background: "transparent", color: "var(--white)", padding: "14px 28px", borderRadius: 4, fontWeight: 700, fontSize: 14, border: "2px solid var(--white)" }}>
                ✉️ Email Us
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
