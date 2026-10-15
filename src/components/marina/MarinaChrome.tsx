import Link from "next/link";
import "./marina.css";
import type { MarinaCompany } from "@/lib/marina/company";
import { isDemoDomain } from "@/lib/marina/host";

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
            {company.logo_url ? <img src={company.logo_url} alt="" /> : null}
            {company.company_name}
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
