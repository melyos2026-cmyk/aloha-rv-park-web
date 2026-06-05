import Link from "next/link";

export default function Footer() {
  return (
    <footer style={{ background: "var(--black)", color: "var(--white)", padding: "60px 24px 30px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 40, marginBottom: 48 }}>
          
          {/* Brand */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 24 }}>
                <span style={{ color: "var(--white)" }}>★</span>
                <span style={{ color: "var(--red)" }}>★</span>
              </div>
              <div>
                <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 900, fontSize: 16 }}>ALOHA RV PARK</div>
                <div style={{ fontSize: 10, color: "#9ca3af", letterSpacing: "0.15em", textTransform: "uppercase" }}>Kissimmee, Florida</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.7 }}>
              Your home away from home near Orlando's best attractions.
            </p>
          </div>

          {/* Contact */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 16 }}>Contact</h4>
            <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 2 }}>
              <div>4648 S. Orange Blossom Trl</div>
              <div>Kissimmee, FL 34746</div>
              <a href="tel:6892520567" style={{ display: "block", color: "var(--white)", fontWeight: 600 }}>(689) 252-0567</a>
              <a href="mailto:info@aloharvparkfl.com" style={{ color: "#9ca3af" }}>info@aloharvparkfl.com</a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 16 }}>Quick Links</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[["Home","/"],["Residents","/residents"],["Apply","/apply"],["Real Estate","/real-estate"],["Events","/events"]].map(([l,h]) => (
                <Link key={h} href={h} style={{ fontSize: 13, color: "#d1d5db", transition: "color 0.2s" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#d1d5db")}>
                  {l}
                </Link>
              ))}
            </div>
          </div>

          {/* Hours */}
          <div>
            <h4 style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 16 }}>Office Hours</h4>
            <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 2 }}>
              <div>Mon – Fri: 8:00 AM – 5:00 PM</div>
              <div>Saturday: 10:00 AM – 3:00 PM</div>
              <div style={{ color: "#9ca3af" }}>Sunday: Closed</div>
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #374151", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 12, color: "#6b7280" }}>© 2026 Aloha RV Park. All rights reserved.</p>
          <p style={{ fontSize: 12, color: "#6b7280" }}>4648 S. Orange Blossom Trl, Kissimmee, FL 34746</p>
        </div>
      </div>
    </footer>
  );
}
