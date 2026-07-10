"use client";
import Link from "next/link";

export default function Footer() {
  return (
    <footer style={{ background: "var(--sea)", color: "var(--black)", padding: "60px 24px 30px", borderTop: "6px solid var(--white)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 40, marginBottom: 48 }}>
          
          {/* Brand */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <img src="/aloha-logo-footer.png" alt="Aloha RV Park Compass" style={{ height: 90, width: "auto" }} />
              <div>
                <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 900, fontSize: 16 }}>ALOHA RV PARK</div>
                <div style={{ fontSize: 10, color: "#4b5563", letterSpacing: "0.15em", textTransform: "uppercase" }}>Kissimmee, Florida</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
              Your home away from home near Orlando's best attractions.
            </p>
          </div>

          {/* Contact */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#4b5563", marginBottom: 16 }}>Contact</h4>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 2 }}>
              <div>4648 S. Orange Blossom Trl</div>
              <div>Kissimmee, FL 34746</div>
              <a href="tel:6892520567" style={{ display: "block", color: "var(--red-dark)", fontWeight: 600 }}>(689) 252-0567</a>
              <a href="mailto:info@aloharvparkfl.com" style={{ color: "#4b5563" }}>info@aloharvparkfl.com</a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#4b5563", marginBottom: 16 }}>Quick Links</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[["Home","/"],["Residents","/residents"],["Apply","/apply"],["Real Estate","/real-estate"],["Events","/events"]].map(([l,h]) => (
                <Link key={h} href={h} style={{ fontSize: 13, color: "#374151", transition: "color 0.2s" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--red-dark)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#374151")}>
                  {l}
                </Link>
              ))}
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#4b5563", marginBottom: 16 }}>Office Hours</h4>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 2 }}>
              <div>Mon – Fri: 8:00 AM – 5:00 PM</div>
              <div>Saturday: 10:00 AM – 3:00 PM</div>
              <div style={{ color: "#4b5563" }}>Sunday: Closed</div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.15)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 12, color: "#4b5563" }}>© 2026 Aloha RV Park. All rights reserved.</p>
          <p style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>
            Powered by{" "}
            <a href="https://melyos.io" target="_blank" rel="noopener noreferrer" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>
              MelyOS.io
            </a>
          </p>
          <p style={{ fontSize: 12, color: "#4b5563" }}>4648 S. Orange Blossom Trl, Kissimmee, FL 34746</p>
        </div>
      </div>
    </footer>
  );
}
