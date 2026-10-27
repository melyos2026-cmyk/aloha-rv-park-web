import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadBookingByLink, bookingMoney, loadTransientRules } from "@/lib/marina/booking";
import PayLinkButton from "@/components/marina/PayLinkButton";

// Oct 26 (per Mely): the guest's private booking page (link in the confirmation email). Shows the
// slip, the dates, what was paid and, when the marina takes a deposit, the balance with a button
// to pay it. No account needed.
export const dynamic = "force-dynamic";
export const metadata = { title: "Your slip booking", robots: { index: false } };

const money = (n: number | null | undefined) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
const UNIT: Record<string, string> = { transient_daily: "night", transient_weekly: "week", monthly: "month" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; paid?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const company = await getMarinaForPage();
  if (!company) notFound();
  const r = await loadBookingByLink(company.id, id, String(sp.t || ""));
  if (!r) notFound();
  const [{ data: slip }, m, rules] = await Promise.all([
    supabaseAdmin.from("marina_slips").select("slip_name, dock").eq("id", r.slip_id).eq("company_id", company.id).maybeSingle(),
    bookingMoney(company.id, r),
    loadTransientRules(company.id),
  ]);
  // Oct 27 (per Mely): check-in/out times
  const t12 = (t?: string | null) => { if (!t) return ""; const [h, mm] = String(t).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(mm || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const slipLabel = `${slip?.slip_name || ""}${slip?.dock ? ` · ${slip.dock}` : ""}`;
  const head =
    r.status === "cancelled" ? { cls: "off", title: "This booking was cancelled", sub: company.contact_phone ? `Questions? Call ${company.contact_phone}.` : "" }
    : r.status === "pending" ? { cls: "prep", title: sp.paid ? "Finishing your payment…" : "Waiting for your payment", sub: sp.paid ? "This takes a few seconds. Refresh the page if it doesn't change." : "Your slip is held for 30 minutes while you pay." }
    : m.balanceLeft > 0 ? { cls: "ready", title: `Slip ${slip?.slip_name || ""} is booked`, sub: `Deposit received. ${money(m.balanceLeft)} is due by ${day(r.balance_due_date || r.start_date)}.` }
    : { cls: "done", title: `You're all set: slip ${slip?.slip_name || ""}`, sub: `Paid in full. See you on ${day(r.start_date)}!` };

  return (
    <div className="mr-wrap mr-order mr-wo">
      <div className={`mr-order-status ${head.cls}`}>
        <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{company.company_name}{m.confirmation ? ` · Booking ${m.confirmation}` : ""}</div>
        <div className="mr-order-status-title" style={{ marginTop: 4 }}>{head.title}</div>
        <div className="mr-order-status-sub">{head.sub}</div>
      </div>
      <div className="mr-order-grid">
        <section className="mr-order-box">
          <div className="mr-order-label">Your booking</div>
          <div className="mr-order-where" style={{ marginTop: 8 }}>
            <div><div className="mr-order-label">Slip</div><b>{slipLabel}</b></div>
            <div><div className="mr-order-label">Arrive</div><b>{day(r.start_date)}</b><div style={{ fontSize: 13, color: "var(--mr-muted)" }}>Check-in from {t12(rules.checkin)}{r.arrival_time ? ` · you expect ${t12(r.arrival_time)}` : ""}</div></div>
            <div><div className="mr-order-label">Depart</div><b>{day(r.end_date)}</b><div style={{ fontSize: 13, color: "var(--mr-muted)" }}>Check-out by {t12(rules.checkout)}</div></div>
            <div><div className="mr-order-label">Boat</div><b>{r.boat_name || "Your boat"}</b>{r.boat_length_ft ? <div style={{ fontSize: 13, color: "var(--mr-muted)" }}>{r.boat_length_ft} ft</div> : null}</div>
          </div>
        </section>
        <section className="mr-order-box">
          <div className="mr-order-label">Payment</div>
          <table className="mr-pay-lines" style={{ width: "100%", marginTop: 8 }}>
            <tbody>
              <tr><td>{r.units} {UNIT[r.stay_type] || "stay"}{r.units > 1 ? "s" : ""}</td><td style={{ textAlign: "right" }}>{money(r.amount)}</td></tr>
              <tr><td>Paid</td><td style={{ textAlign: "right" }}>{money(m.paid)}</td></tr>
              {m.balanceLeft > 0 && <tr><td><b>Balance due {day(r.balance_due_date || r.start_date)}</b></td><td style={{ textAlign: "right" }}><b>{money(m.balanceLeft)}</b></td></tr>}
            </tbody>
          </table>
          {r.status === "confirmed" && m.balanceLeft > 0 && (
            <div style={{ marginTop: 14 }}>
              <PayLinkButton url="/api/marina/reservation" body={{ id: r.id, t: sp.t }} label={`Pay the balance, ${money(m.balanceLeft)}`} />
              <p style={{ fontSize: 13, color: "var(--mr-muted)", marginTop: 8 }}>You can also pay at the dock office when you arrive.</p>
            </div>
          )}
          {company.contact_phone && <p style={{ marginTop: 14, fontSize: 14, color: "var(--mr-muted)" }}>Questions? Call <a href={`tel:${company.contact_phone}`}>{company.contact_phone}</a>.</p>}
        </section>
      </div>
    </div>
  );
}
