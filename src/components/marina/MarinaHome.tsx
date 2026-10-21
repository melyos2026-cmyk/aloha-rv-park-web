import Link from "next/link";
import type { MarinaCompany } from "@/lib/marina/company";
import { loadPublicSlips, summarizeRates, RATE_LABEL, RATE_TYPES, loadFuelPrices } from "@/lib/marina/data";
import SlipBoard from "./SlipBoard";
import WaitlistForm from "./WaitlistForm";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

const CAPABILITIES: [string, string][] = [
  ["Pay online, any hour", "Boaters see every open invoice and pay by card without calling the office."],
  ["One account per boater", "Boats, slip, balance and payment history in one place."],
  ["Live slip board", "Visitors see which slips are open and which fit their boat before they call."],
  ["Waitlist that runs itself", "Sign-ups land straight in the marina office, ranked and ready to offer."],
  ["Receipts and records", "Every payment is logged with who, when and how, ready for audits."],
  ["Run from one dashboard", "Slips, rates, invoices and boaters are managed in the marina office system."],
];

export default async function MarinaHome({ company }: { company: MarinaCompany }) {
  const [slips, fuel] = await Promise.all([loadPublicSlips(company.id), loadFuelPrices(company.id)]);
  const open = slips.filter((s) => s.status === "available").length;
  const rates = summarizeRates(slips);
  const rateRows = RATE_TYPES.filter((t) => rates[t]);
  const longest = Math.max(0, ...slips.map((s) => s.length_ft || 0));
  const headline = company.hero_headline || `Your boat's home on the water.`;
  const sub =
    company.hero_subtext ||
    `Secure a slip, check availability and pay your dockage online at ${company.company_name}.`;

  return (
    <>
      <section className="mr-hero" aria-label={`${company.company_name} marina`}>
        <img className="mr-hero-photo full" src={company.hero_image_url || "/marina/hero.jpg"} alt={`${company.company_name}: slips at sunset and an overhead view of the docks`} />
      </section>

      <section className="mr-intro">
        <div className="mr-wrap">
          <h1>{headline}</h1>
          <p>{sub}</p>
          <div className="mr-hero-cta">
            <a className="mr-btn" href="#slips">See open slips</a>
            <Link className="mr-btn ghost" href="/marina/account">Boater login</Link>
          </div>
        </div>
      </section>

      <div className="mr-strip">
        <div className="mr-wrap">
          <span><b>{open}</b>{open === 1 ? "slip open now" : "slips open now"}</span>
          <span><b>{slips.length}</b>slips in total</span>
          {longest > 0 && <span><b>{longest} ft</b>longest slip</span>}
          <span><b>24/7</b>online account and payments</span>
        </div>
      </div>

      <section className="mr-section" id="slips">
        <div className="mr-wrap">
          <h2 className="mr-h2">Find a slip that fits</h2>
          <p className="mr-lede">Enter your boat length, tap a slip and see its size, hookups and price.</p>
          <SlipBoard slips={slips} />
        </div>
      </section>

      <section className="mr-section alt" id="rates">
        <div className="mr-wrap">
          <h2 className="mr-h2">Rates</h2>
          <p className="mr-lede">Starting prices by stay length. Final price depends on slip size.</p>
          {rateRows.length ? (
            <table className="mr-table">
              <thead><tr><th>Stay</th><th>Members</th><th>Visitors</th></tr></thead>
              <tbody>
                {rateRows.map((t) => (
                  <tr key={t}>
                    <td>{RATE_LABEL[t]}</td>
                    <td className="num">{money(rates[t]!.resident)}</td>
                    <td className="num">{money(rates[t]!.non_resident)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mr-note">Rates are posted at the marina office.</p>
          )}
          <p className="mr-note">Card payments include a small processing fee shown before you pay.</p>
        </div>
      </section>

      {/* Oct 21 (per Mely — Fuel Dock): today's fuel prices, straight from the admin. */}
      {fuel.length > 0 && (
        <section className="mr-section" id="fuel">
          <div className="mr-wrap">
            <h2 className="mr-h2">Fuel dock</h2>
            <p className="mr-lede">Today&apos;s prices per gallon. Members can charge fuel to their account.</p>
            <table className="mr-table">
              <thead><tr><th>Fuel</th><th>Price per gallon</th></tr></thead>
              <tbody>
                {fuel.map((f) => (
                  <tr key={f.label}>
                    <td>{f.label}</td>
                    <td className="num">${f.price_per_gallon.toFixed(3)}{f.tax_included ? " (tax incl.)" : " + tax"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mr-section">
        <div className="mr-wrap mr-split">
          <div>
            <h2 className="mr-h2">Your account, always open</h2>
            <p className="mr-lede">Sign in with just your email. No password to forget.</p>
            <ul className="mr-list">
              <li>See what you owe and what you have paid</li>
              <li>Pay a dockage or membership invoice in a few taps</li>
              <li>Keep your boats and slip on file</li>
              <li>Dry stack: ask for your boat to be put in the water</li>
            </ul>
            <p style={{ marginTop: 24 }}><Link className="mr-btn dark" href="/marina/account">Open my account</Link></p>
          </div>
          <div className="mr-card" aria-label="Example of the boater account">
            <h3>Slip fees, October</h3>
            <p className="mr-note" style={{ marginTop: 0 }}>Example account view</p>
            <div className="mr-inv"><div>Monthly slip rent<small>Due Oct 1</small></div><span className="mr-money">$480.00</span></div>
            <div className="mr-inv"><div>Electric, September<small>Due Oct 10</small></div><span className="mr-money">$64.20</span></div>
            <div className="mr-inv"><div><b>Total due</b></div><span className="mr-money">$544.20</span></div>
            <span className="mr-btn" role="presentation" style={{ width: "100%", marginTop: 8 }}>Pay $544.20</span>
          </div>
        </div>
      </section>

      <section className="mr-section alt">
        <div className="mr-wrap">
          <h2 className="mr-h2">Everything a marina office needs, online</h2>
          <p className="mr-lede">Built for private marinas and public ones: city, county and port authority.</p>
          <div className="mr-caps">
            {CAPABILITIES.map(([t, d]) => (
              <div className="mr-cap" key={t}><h4>{t}</h4><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="mr-section" id="waitlist">
        <div className="mr-wrap mr-split" style={{ alignItems: "start" }}>
          <div>
            <h2 className="mr-h2">Join the waitlist</h2>
            <p className="mr-lede">No open slip that fits? Tell us about your boat and we will contact you the moment one opens.</p>
          </div>
          <WaitlistForm />
        </div>
      </section>
    </>
  );
}
