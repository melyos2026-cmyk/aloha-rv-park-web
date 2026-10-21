import Link from "next/link";
import type { MarinaCompany } from "@/lib/marina/company";
import { loadPublicSlips, ratesBySlipType, RATE_LABEL, loadFuelPrices, loadStoreItems } from "@/lib/marina/data";
import SlipBoard from "./SlipBoard";
import WaitlistForm from "./WaitlistForm";

// Whole dollars show as $280; anything with cents always shows two decimals ($2,553.60).
const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);

// Price per foot always shows cents so a column lines up: $14.00, $16.50.
const ft = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const CAPABILITIES: [string, string][] = [
  ["Pay online, any hour", "Boaters see every open invoice and pay by card without calling the office."],
  ["One account per boater", "Boats, slip, balance and payment history in one place."],
  ["Live slip board", "Visitors see which slips are open and which fit their boat before they call."],
  ["Waitlist that runs itself", "Sign-ups land straight in the marina office, ranked and ready to offer."],
  ["Receipts and records", "Every payment is logged with who, when and how, ready for audits."],
  ["Run from one dashboard", "Slips, rates, invoices and boaters are managed in the marina office system."],
];

export default async function MarinaHome({ company }: { company: MarinaCompany }) {
  const [slips, fuel, store] = await Promise.all([loadPublicSlips(company.id), loadFuelPrices(company.id), loadStoreItems(company.id)]);
  const storeGroups = store.reduce<Record<string, typeof store>>((g, i) => { (g[i.category] ||= []).push(i); return g; }, {});
  const open = slips.filter((s) => s.status === "available").length;
  const rates = ratesBySlipType(slips);
  const TYPE_LABEL = { wet: "Wet slips", lift: "Boat lifts", dry: "Dry storage" } as const;
  const STAY_NOTE: Record<string, string> = { annual: "per year", seasonal: "per season", monthly: "per month", transient_weekly: "per week", transient_daily: "per night" };
  const anyPerFoot = rates.rows.some((r) => Object.values(r.cells).some((c) => c?.perFoot));
  const exRow = rates.rows.find((r) => r.type === "monthly") || rates.rows[0];
  const exType = exRow ? rates.types.find((t) => exRow.cells[t]?.perFoot && exRow.cells[t]?.visitor != null) : undefined;
  const ex = exRow && exType ? { r: exRow.type, t: exType, pf: exRow.cells[exType]!.visitor as number } : null;
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
          <p className="mr-lede">{anyPerFoot ? "Priced per foot of boat length, by type of space. Members pay the lower rate." : "Starting prices by stay length and type of space."}</p>
          {rates.rows.length ? (
            <div className="mr-table-scroll">
              <table className="mr-table mr-rates">
                <thead><tr><th>Stay</th>{rates.types.map((t) => <th key={t}>{TYPE_LABEL[t]}</th>)}</tr></thead>
                <tbody>
                  {rates.rows.map((r) => (
                    <tr key={r.type}>
                      <td>{RATE_LABEL[r.type]}<span className="mr-rate-sub">{STAY_NOTE[r.type]}</span></td>
                      {rates.types.map((t) => {
                        const c = r.cells[t];
                        if (!c || c.visitor == null) return <td key={t} className="num mr-rate-none" title="Not offered">—</td>;
                        return (
                          <td key={t} className="num">
                            {c.perFoot ? <>{ft(c.visitor)}<small> /ft</small></> : <><small>from </small>{money(c.visitor)}</>}
                            {c.member != null && c.member !== c.visitor && <span className="mr-rate-sub">Members {c.perFoot ? `${ft(c.member)} /ft` : money(c.member)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mr-note">Rates are posted at the marina office.</p>
          )}
          {ex && <p className="mr-note">Example: a 30 ft boat in {TYPE_LABEL[ex.t].toLowerCase()} at {ft(ex.pf)} /ft {STAY_NOTE[ex.r]} pays {money(Math.round(ex.pf * 30 * 100) / 100)} {STAY_NOTE[ex.r]}. Tap a slip above to see its exact price.</p>}
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

      {/* Oct 21 (per Mely — Ship Store): what the store sells, straight from the admin. */}
      {store.length > 0 && (
        <section className="mr-section" id="store">
          <div className="mr-wrap">
            <h2 className="mr-h2">Ship store</h2>
            <p className="mr-lede">Ice, bait, drinks and boat supplies at the dock. Members can charge purchases to their account. Prices before sales tax.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
              {Object.entries(storeGroups).map(([cat, items]) => (
                <table className="mr-table" key={cat}>
                  <thead><tr><th>{cat}</th><th>Price</th></tr></thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.name}>
                        <td>{i.name}</td>
                        <td className="num">{i.soldOut ? "Sold out" : `$${i.price.toFixed(2)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
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
          {/* Oct 21 (per Mely): link to the office tour on demo marinas */}
          {/melyos\.io$/i.test(company.domain || "") && (
            <p style={{ marginTop: 14 }}><Link className="mr-btn dark" href="/marina/tour">Take the office tour</Link></p>
          )}
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
