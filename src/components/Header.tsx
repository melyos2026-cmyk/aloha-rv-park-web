"use client";
import { useState } from "react";
import Link from "next/link";
import { useCompany } from "@/lib/CompanyContext";

const nav = [
  { label: "Home", href: "/" },
  { label: "Apply", href: "/apply" },
  { label: "Real Estate", href: "/real-estate" },
  { label: "Events", href: "/events" },
  { label: "Residents Login", href: "/login" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const { company } = useCompany();

  const companyName = company?.company_name || "Aloha RV Park";
  const logoUrl = company?.logo_url || "/aloha-logo.png";
  const phone = company?.contact_phone || "(689) 252-0567";
  const phoneHref = `tel:${phone.replace(/[^\d]/g, "")}`;

  return (
    <>
      {/* Announcement Bar */}
      <div style={{ background: "var(--blue-light)", color: "var(--blue-accent)", textAlign: "center", padding: "10px 20px", fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" }}>
        🌴 Now accepting new residents! Call us at <a href={phoneHref} style={{ color: "var(--blue-accent)", fontWeight: 700, textDecoration: "underline" }}>{phone}</a> or <Link href="/apply" style={{ color: "var(--blue-accent)", fontWeight: 700, textDecoration: "underline" }}>Apply Online</Link>
      </div>

      {/* Header */}
      <header style={{ background: "var(--white)", borderBottom: "2px solid var(--black)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 70 }}>
          
          {/* Logo */}
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={logoUrl} alt={`${companyName} Logo`} style={{ height: 70, width: "auto" }} />
            <div>
              <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 900, fontSize: 18, color: "var(--black)", lineHeight: 1 }}>{companyName.toUpperCase()}</div>
              {company?.address && (
                <div style={{ fontSize: 10, color: "var(--gray)", letterSpacing: "0.05em", textTransform: "uppercase" }}>{company.address}</div>
              )}
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav style={{ display: "flex", gap: 32, alignItems: "center" }} className="desktop-nav">
            {nav.map(n => (
              <Link key={n.href} href={n.href} style={{ fontSize: 14, fontWeight: 600, color: "var(--black)", letterSpacing: "0.03em", textTransform: "uppercase", transition: "color 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.color = "var(--red)")}
                onMouseLeave={e => (e.currentTarget.style.color = "var(--black)")}>
                {n.label}
              </Link>
            ))}
            <a href={phoneHref} style={{ background: "var(--mint)", color: "var(--red-dark)", padding: "10px 20px", borderRadius: 4, fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>
              📞 CALL US
            </a>
          </nav>

          {/* Mobile Menu Button */}
          <button onClick={() => setOpen(!open)} style={{ display: "none", background: "none", border: "none", fontSize: 24 }} className="mobile-menu-btn">
            {open ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile Nav */}
        {open && (
          <div style={{ background: "var(--white)", borderTop: "1px solid var(--border)", padding: "16px 24px" }} className="mobile-nav">
            {nav.map(n => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                style={{ display: "block", padding: "12px 0", fontSize: 15, fontWeight: 600, borderBottom: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {n.label}
              </Link>
            ))}
            <a href={phoneHref} style={{ display: "block", marginTop: 16, background: "var(--red)", color: "var(--white)", padding: "12px 20px", borderRadius: 4, textAlign: "center", fontWeight: 700 }}>
              📞 {phone}
            </a>
          </div>
        )}
      </header>

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
      `}</style>
    </>
  );
}
