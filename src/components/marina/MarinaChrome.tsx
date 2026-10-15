import MarinaMely from "./MarinaMely";
import Link from "next/link";
import "./marina.css";
import type { MarinaCompany } from "@/lib/marina/company";
import { isDemoDomain } from "@/lib/marina/host";

// Used until the marina uploads its own logo in the admin (Company settings).
function Emblem() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="21" stroke="#6fb1dc" />
      <circle cx="24" cy="12.5" r="3.2" />
      <path d="M24 15.7V37M17 21h14M11.5 27.5c1.2 6.2 6.2 9.8 12.5 9.8s11.3-3.6 12.5-9.8M11.5 27.5l-2.6 3.6M36.5 27.5l2.6 3.6" />
    </svg>
  );
}

export function MarinaShell({ company, children }: { company: MarinaCompany; children: React.ReactNode }) {
  const demo = isDemoDomain(company.domain);
  const style = {
  } as React.CSSProperties;
  return (
    <div className="mr-root" style={style}>
      {demo && (
        <div className="mr-demobar">
          Live demo of a MelyOS marina website. Payments here are simulated, no card is ever charged.
        </div>
      )}
      <header className="mr-header">
        <div className="mr-wrap">
          <Link href="/" className="mr-brand">
            {company.logo_url ? <img src={company.logo_url} alt="" /> : <Emblem />}
            <span className="mr-name">{company.company_name}<small>Marina</small></span>
          </Link>
          <nav className="mr-nav" aria-label="Main">
            <a className="mr-link" href="/#slips">Slips</a>
            <a className="mr-link" href="/#rates">Rates</a>
            <a className="mr-link" href="/#waitlist">Waitlist</a>
            <a className="mr-link" href="/#contact">Contact</a>
            <Link className="mr-btn" href="/marina/account">Boater login</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <MarinaMely companyName={company.company_name} demo={demo} />
      <footer className="mr-footer" id="contact">
        <div className="mr-wrap">
          <div className="mr-footer-grid">
            <div>
              <h4>{company.company_name}</h4>
              {company.address && <p>{company.address}</p>}
              {company.contact_phone && (
                <p>
                  <a href={`tel:${company.contact_phone.replace(/[^\d+]/g, "")}`}>{company.contact_phone}</a>
                </p>
              )}
              {company.contact_email && (
                <p>
                  <a href={`mailto:${company.contact_email}`}>{company.contact_email}</a>
                </p>
              )}
            </div>
            <div>
              <h4>For boaters</h4>
              <p><a href="/#slips">See open slips</a></p>
              <p><a href="/#waitlist">Join the waitlist</a></p>
              <p><Link href="/marina/account">Pay an invoice</Link></p>
            </div>
            <div>
              <h4>Fuel dock and office</h4>
              <p>Office hours, fuel and pump-out times are posted at the dock office. Call ahead for transient stays.</p>
            </div>
          </div>
          <small>
            © {new Date().getFullYear()} {company.company_name}. Website and boater accounts by{" "}
            <a href="https://melyos.io">MelyOS</a>.
          </small>
        </div>
      </footer>
    </div>
  );
}
