import Link from "next/link";

// Oct 21 (per Mely): the office tour. Each step shows a real screenshot of the
// marina admin when one is available in /public/marina/tour, otherwise a clean
// summary card. Text stays honest: only features that exist today.

type Step = { key: string; kicker: string; title: string; text: string; points: string[]; image?: string };

const STEPS: Step[] = [
  {
    key: "dashboard", kicker: "1 · Dashboard", title: "Your whole marina at a glance",
    text: "The first screen your office sees every morning.",
    points: ["Open and occupied slips", "Balances due and overdue invoices", "Waitlist, renewals due and expiring insurance or registration"],
  },
  {
    key: "slips", kicker: "2 · Slips, map & rates", title: "An interactive map of your docks",
    text: "The same aerial map boaters use on your website, managed from the office.",
    points: ["Wet slips, lift slips and dry storage", "Size, power, water and a photo for every slip", "Member and visitor rates: annual, seasonal, monthly, weekly and daily"],
  },
  {
    key: "fuel", kicker: "3 · Fuel dock", title: "Sell fuel and always know what's in the tanks",
    text: "Every fill-up becomes a sale, a receipt and a line in the daily close.",
    points: ["Sell by gallons or by dollar amount", "Cash, card, check or charge it to the boat owner's account", "Tank levels drop with every sale; low-fuel alerts and delivery log", "Pumps listed in the system, built to connect a compatible pump controller (today staff enter the gallons)"],
  },
  {
    key: "store", kicker: "4 · Ship store", title: "A point of sale for the counter",
    text: "Ice, bait, drinks and boat supplies, rung up in seconds.",
    points: ["Scan barcodes with a USB or Bluetooth scanner, or the phone camera", "Stock goes down with every sale, with low-stock alerts", "Upload your whole product list from Excel or Google Sheets", "Sales tax on taxable items; charge to the boat owner's account"],
  },
  {
    key: "drystack", kicker: "5 · Dry stack", title: "The launch board for your forklift team",
    text: "Boaters ask from their phone; your team sees the day's launches in order.",
    points: ["“Put my boat in the water” from the boater account", "New request → confirmed → in the water → back on the rack", "Phone requests added by staff in seconds"],
  },
  {
    key: "billing", kicker: "6 · Shifts & daily close", title: "Every dollar tied to a person and a shift",
    text: "Built for audits, including city and county marinas.",
    points: ["Each employee opens and closes a shift", "The system counts what the drawer should have", "Fuel, store and invoice payments all land in the close"],
  },
  {
    key: "invoices", kicker: "7 · Invoices & accounting", title: "Billing that runs itself",
    text: "Slip fees, utilities, fuel, store and late fees in one place.",
    points: ["Boaters pay online 24/7 from their account", "Overdue invoices and late fees in one click", "Export for QuickBooks Online and print any report as a PDF with your logo"],
  },
  {
    key: "renewals", kicker: "8 · Annual renewals & waitlist", title: "The yearly busy work, handled",
    text: "The tasks that usually live in spreadsheets.",
    points: ["Generate and invoice every annual renewal in one click", "Mark renewed or release the slip to the waitlist", "Waitlist ranked first come, first served, with slip offers"],
  },
  {
    key: "events", kicker: "9 · Event rooms", title: "Rent your meeting room or clubhouse",
    text: "Your office books the room, reviews requests and confirms them.",
    points: ["Hourly, daily or flat pricing per room", "Requests to review, confirmed bookings and totals", "Bill any booking with an invoice in Invoices"],
  },
  {
    key: "contracts", kicker: "10 · Contracts & e-signature", title: "Slip agreements signed online",
    text: "Write your agreement once; every boater signs from their phone.",
    points: ["Price read from your rates, plus extras and deposit from your fee schedule", "Boater signs with an elegant signature; date, IP and document fingerprint recorded", "Signed PDF saved to the boat's documents; invoices created on signing", "Annual renewals sent as contracts in one click"],
  },
  {
    key: "messages", kicker: "11 · Messages", title: "Talk to your boaters, privately",
    text: "Hurricane watch, dock closed, fuel hours: one notice, a private copy for each boater.",
    points: ["Send to everyone, one dock, dry storage or owners with a balance due", "Email plus the boater's account; see who has read it", "Replies come only to the office, never to the whole group"],
  },
  {
    key: "mely", kicker: "12 · Mely, your AI assistant", title: "Answers boaters 24/7, in their language",
    text: "Try her now: the chat bubble on this page is the real Mely.",
    points: ["Knows your slips, prices, hours and rules", "Answers in English, Spanish and other languages", "Helps your staff in the office too"],
  },
];

// Screenshots added to /public/marina/tour (key → file).
const SHOTS: Record<string, string> = {
  fuel: "/marina/tour/fuel.jpg",
  drystack: "/marina/tour/drystack.jpg",
  billing: "/marina/tour/billing.jpg",
  store: "/marina/tour/store.jpg",
  invoices: "/marina/tour/invoices.jpg",
  renewals: "/marina/tour/renewals.jpg",
  events: "/marina/tour/events.jpg",
};

export default function TourScreens({ marinaName }: { marinaName: string }) {
  return (
    <>
      <section className="mr-section" style={{ background: "var(--mr-ink, #0a2230)", color: "#fff" }}>
        <div className="mr-wrap">
          <p style={{ textTransform: "uppercase", letterSpacing: ".18em", fontSize: 12, opacity: .75 }}>Office tour · MelyOS for marinas</p>
          <h1 style={{ fontSize: "clamp(2rem, 4.5vw, 3.2rem)", fontWeight: 800, margin: "8px 0 12px", color: "#fff" }}>Inside the marina office</h1>
          <p style={{ maxWidth: "62ch", fontSize: "1.1rem", opacity: .9 }}>
            The public site you just saw is what boaters use. This is what your staff uses. Every screen below comes from {marinaName}, this demo marina.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
            <a className="mr-btn" href="#steps">Start the tour</a>
            <a className="mr-btn ghost" href="mailto:melyos2026@gmail.com?subject=Marina%20walkthrough%20request&body=Hi%20MelyOS%2C%20I%27d%20like%20a%20live%20walkthrough%20for%20our%20marina.%0A%0AMarina%3A%20%0ANumber%20of%20slips%3A%20%0APhone%3A%20">Book a live walkthrough</a>
          </div>
        </div>
      </section>

      <div id="steps">
        {STEPS.map((s, i) => {
          const img = SHOTS[s.key];
          return (
            <section key={s.key} className={`mr-section${i % 2 ? " alt" : ""}`}>
              <div className="mr-wrap mr-split" style={{ alignItems: "center" }}>
                <div style={{ order: i % 2 ? 2 : 1 }}>
                  <p style={{ textTransform: "uppercase", letterSpacing: ".14em", fontSize: 12, fontWeight: 700, color: "var(--mr-muted)" }}>{s.kicker}</p>
                  <h2 className="mr-h2">{s.title}</h2>
                  <p className="mr-lede">{s.text}</p>
                  <ul className="mr-list">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
                <div style={{ order: i % 2 ? 1 : 2 }}>
                  {img ? (
                    <figure style={{ margin: 0, borderRadius: 12, overflow: "hidden", border: "1px solid var(--mr-line)", boxShadow: "0 30px 60px -30px rgba(10,34,48,.55)", background: "#fff" }}>
                      <div style={{ display: "flex", gap: 6, padding: "9px 12px", background: "#eef2f5", borderBottom: "1px solid var(--mr-line)" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 9, background: "#f87171" }} />
                        <span style={{ width: 10, height: 10, borderRadius: 9, background: "#fbbf24" }} />
                        <span style={{ width: 10, height: 10, borderRadius: 9, background: "#34d399" }} />
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={`${s.title} — MelyOS marina office`} style={{ display: "block", width: "100%", height: "auto" }} />
                    </figure>
                  ) : (
                    <div className="mr-card" style={{ padding: 28, background: "linear-gradient(140deg,#0b1e36,#1f3a5f)", color: "#fff", border: "none" }}>
                      <div style={{ fontSize: 12, letterSpacing: ".2em", textTransform: "uppercase", opacity: .7 }}>Marina Management</div>
                      <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 18px", fontFamily: "Georgia, serif" }}>{s.title}</div>
                      {s.points.slice(0, 3).map((p) => (
                        <div key={p} style={{ background: "rgba(255,255,255,.09)", borderRadius: 8, padding: "10px 12px", marginTop: 8, fontSize: 14 }}>{p}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="mr-section" style={{ background: "var(--mr-ink, #0a2230)", color: "#fff", textAlign: "center" }}>
        <div className="mr-wrap">
          <h2 className="mr-h2" style={{ color: "#fff" }}>See it with your own slips</h2>
          <p style={{ maxWidth: "60ch", margin: "0 auto", opacity: .9 }}>
            MelyOS is built in Florida. We set it up for you: your map, your slips, your rates and your website. In a 20-minute call we&apos;ll show you the office live and answer every question.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 24 }}>
            <a className="mr-btn" href="mailto:melyos2026@gmail.com?subject=Marina%20walkthrough%20request&body=Hi%20MelyOS%2C%20I%27d%20like%20a%20live%20walkthrough%20for%20our%20marina.%0A%0AMarina%3A%20%0ANumber%20of%20slips%3A%20%0APhone%3A%20">Book a live walkthrough</a>
            <Link className="mr-btn ghost" href="/">Back to the marina website</Link>
          </div>
          <p className="mr-note" style={{ color: "rgba(255,255,255,.7)" }}>Prefer to chat? Ask Mely in the bubble below — she can pass your details to our team.</p>
        </div>
      </section>
    </>
  );
}
