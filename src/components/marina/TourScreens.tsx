import Link from "next/link";

// Oct 21 (per Mely): the office tour. Each step shows a real screenshot of the
// marina admin when one is available in /public/marina/tour, otherwise a clean
// summary card. Text stays honest: only features that exist today.

type Step = { key: string; kicker: string; title: string; text: string; points: string[]; image?: string };

const STEPS: Step[] = [
  {
    key: "dashboard", kicker: "1 · Dashboard", title: "Today at the docks, at a glance",
    text: "The first screen your office sees every morning.",
    points: ["Who arrives and who leaves today or tomorrow, with one-tap check-in and check-out", "Occupancy by dock: in use, reserved this week, out of service", "Launches today, open work orders, balances due, renewals and expiring insurance"],
  },
  {
    key: "slips", kicker: "2 · Slips, map & rates", title: "An interactive map of your docks",
    text: "The same aerial map boaters use on your website, managed from the office.",
    points: ["Wet slips, lift slips and dry storage", "Size, power, water and a photo for every slip", "Member and visitor rates: annual, seasonal, monthly, weekly and daily"],
  },
  {
    key: "requests", kicker: "3 · Slip requests", title: "A boater asks for a slip, the system does the rest",
    text: "Monthly, seasonal and annual slips, from the request to the deposit, without the office lifting a finger.",
    points: ["The boater types the boat's size and power; only slips that fit and are free are offered, best fit first", "The price appears at once from your rates; they accept, sign the contract online and pay the deposit", "Insurance and registration uploaded from the phone; you get an email at every step and only step in when no slip fits"],
  },
  {
    key: "calendar", kicker: "4 · Slip calendar", title: "Every slip, day by day",
    text: "Week, two weeks or month: who is in each slip and when, plus your service yard.",
    points: ["Reservations, guests on the dock, contracts and boats kept in each slip, in colors anyone understands", "“Find a free slip”: type the boat length and dates, see only the slips that fit", "Click any stay to check the guest in or out, or move them to another free slip"],
  },
  {
    key: "fuel", kicker: "5 · Fuel dock", title: "Sell fuel and always know what's in the tanks",
    text: "Every fill-up becomes a sale, a receipt and a line in the daily close.",
    points: ["Sell by gallons or by dollar amount", "Cash, card, check or charge it to the boat owner's account", "Tank levels drop with every sale; low-fuel alerts and delivery log", "Pumps listed in the system, built to connect a compatible pump controller (today staff enter the gallons)"],
  },
  {
    key: "store", kicker: "6 · Ship store", title: "A point of sale for the counter",
    text: "Ice, bait, drinks and boat supplies, rung up in seconds.",
    points: ["Scan barcodes with a USB or Bluetooth scanner, or the phone camera", "Stock goes down with every sale, with low-stock alerts", "Upload your whole product list from Excel or Google Sheets", "Sales tax on taxable items; charge to the boat owner's account"],
  },
  {
    key: "drystack", kicker: "7 · Dry stack", title: "The launch board for your forklift team",
    text: "Boaters ask from their phone; your team sees the day's launches in order.",
    points: ["“Put my boat in the water” from the boater account", "New request → confirmed → in the water → back on the rack", "Phone requests added by staff in seconds"],
  },
  {
    key: "workorders", kicker: "8 · Work orders", title: "Your service yard, from estimate to paid",
    text: "Repairs and service for every boat, with the owner's approval online.",
    points: ["Board: Estimates → Waiting for owner → Approved → In the shop → Ready to bill", "Labor hours, parts with sales tax, fees, technician, travel lift or bay, and dates on the slip calendar", "The owner approves the estimate from their phone; if the price goes up, they're asked again", "Before/after photos, a full timeline, and one click to bill — the owner pays online"],
  },
  {
    key: "meters", kicker: "9 · Electric meters", title: "Read the dock with a phone, bill in one click",
    text: "Shore power billed by what each boat really used.",
    points: ["Type each meter's number: kWh and the charge appear instantly", "Warns about readings much higher than usual or lower than last time", "Bill every reading at once; each owner sees it in their account and pays online"],
  },
  {
    key: "billing", kicker: "10 · Shifts & daily close", title: "Every dollar tied to a person and a shift",
    text: "Built for audits, including city and county marinas.",
    points: ["Each employee opens and closes a shift", "The system counts what the drawer should have", "Fuel, store and invoice payments all land in the close"],
  },
  {
    key: "invoices", kicker: "11 · Invoices & accounting", title: "Billing that runs itself",
    text: "Slip fees, utilities, fuel, store and late fees in one place.",
    points: ["Boaters pay online 24/7 from their account", "Online bookings can take a deposit now and the balance later, with automatic reminders", "Overdue invoices and late fees in one click", "Export for QuickBooks Online and print any report as a PDF with your logo"],
  },
  {
    key: "renewals", kicker: "12 · Annual renewals & waitlist", title: "The yearly busy work, handled",
    text: "The tasks that usually live in spreadsheets.",
    points: ["Generate and invoice every annual renewal in one click", "Mark renewed or release the slip to the waitlist", "Automatic waitlist: when a slip that fits opens up, the first boat in line gets an offer by email; no answer in 48 hours, it goes to the next"],
  },
  {
    key: "events", kicker: "13 · Event rooms", title: "Rent your meeting room or clubhouse",
    text: "Your office books the room, reviews requests and confirms them.",
    points: ["Hourly, daily or flat pricing per room", "Requests to review, confirmed bookings and totals", "Bill any booking with an invoice in Invoices"],
  },
  {
    key: "contracts", kicker: "14 · Contracts & e-signature", title: "Slip agreements signed online",
    text: "Write your agreement once; every boater signs from their phone.",
    points: ["Price read from your rates, plus extras and deposit from your fee schedule", "Boater signs with an elegant signature; date, IP and document fingerprint recorded", "Signed PDF saved to the boat's documents; invoices created on signing", "Annual renewals sent as contracts in one click"],
  },
  {
    key: "messages", kicker: "15 · Messages", title: "Talk to your boaters, privately",
    text: "Hurricane watch, dock closed, fuel hours: one notice, a private copy for each boater.",
    points: ["Send to everyone, one dock, dry storage or owners with a balance due", "Email plus the boater's account; see who has read it", "Replies come only to the office, never to the whole group"],
  },
  {
    key: "mely", kicker: "16 · Mely, your AI assistant", title: "Answers boaters 24/7, in their language",
    text: "Try her now: the chat bubble on this page is the real Mely.",
    points: ["Knows your slips, prices, hours and rules", "Answers in English, Spanish and other languages", "In the office she reads your live data: “Who owes more than 30 days?”, “Do we have room for a 40-ft boat next weekend?”, “How much fuel did we sell this month?”"],
  },
];

// Screenshots added to /public/marina/tour (key → file).
const SHOTS: Record<string, string> = {
  dashboard: "/marina/tour/today.jpg",
  requests: "/marina/tour/requests.jpg",
  calendar: "/marina/tour/calendar.jpg",
  workorders: "/marina/tour/workorders.jpg",
  meters: "/marina/tour/meters.jpg",
  fuel: "/marina/tour/fuel.jpg",
  drystack: "/marina/tour/drystack.jpg",
  billing: "/marina/tour/billing.jpg",
  store: "/marina/tour/store.jpg",
  invoices: "/marina/tour/invoices.jpg",
  renewals: "/marina/tour/waitlist.jpg",
  events: "/marina/tour/events.jpg",
  contracts: "/marina/tour/contracts.jpg",
  messages: "/marina/tour/messages.jpg",
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
