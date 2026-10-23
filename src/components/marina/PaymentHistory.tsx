"use client";

import { useMemo, useState } from "react";

// Oct 23 (per Mely): payment history the boater can search and filter by year and month,
// with what they spent in that period, and a receipt (PDF) for every payment.
type P = { id: string; invoice_id: string; invoice_number: string; description: string; category: string; amount: number; method: string; received_at: string };
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CAT: Record<string, string> = { slip_fee: "Dockage", store: "Store", fuel: "Fuel", security_deposit: "Deposit", electric: "Electric", late_fee: "Late fee" };
const METHOD: Record<string, string> = { card: "Card", cash: "Cash", check: "Check", ach: "ACH", money_order: "Money order", other: "Other" };

export default function PaymentHistory({ payments }: { payments: P[] }) {
  const years = useMemo(() => Array.from(new Set(payments.map((p) => p.received_at.slice(0, 4)))).sort().reverse(), [payments]);
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [q, setQ] = useState("");
  const [show, setShow] = useState(15);

  const list = useMemo(() => payments
    .filter((p) => year === "all" || p.received_at.startsWith(year))
    .filter((p) => month === "all" || p.received_at.slice(5, 7) === month)
    .filter((p) => {
      const t = q.trim().toLowerCase();
      if (!t) return true;
      return `${p.invoice_number} ${p.description} ${CAT[p.category] || p.category} ${p.amount.toFixed(2)}`.toLowerCase().includes(t);
    })
    .sort((a, b) => b.received_at.localeCompare(a.received_at)), [payments, year, month, q]);
  const total = list.reduce((a, p) => a + p.amount, 0);
  const byCat = list.reduce<Record<string, number>>((m, p) => { const k = CAT[p.category] || "Other"; m[k] = (m[k] || 0) + p.amount; return m; }, {});
  const period = year === "all" ? "All time" : month === "all" ? year : `${MONTHS[Number(month) - 1]} ${year}`;
  const input = { padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, background: "#fff", boxSizing: "border-box" as const };

  return (
    <div className="mr-card" id="history" style={{ scrollMarginTop: 110 }}>
      <h3>Payment history</h3>
      {payments.length === 0 ? <p className="mr-note">No payments yet.</p> : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input style={{ ...input, flex: "1 1 180px" }} placeholder="Search (invoice, item, store…)" value={q} onChange={(e) => { setQ(e.target.value); setShow(15); }} />
            <select style={input} value={year} onChange={(e) => { setYear(e.target.value); if (e.target.value === "all") setMonth("all"); setShow(15); }}>
              <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <select style={input} value={month} disabled={year === "all"} onChange={(e) => { setMonth(e.target.value); setShow(15); }}>
              <option value="all">All months</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
            </select>
          </div>
          <div className="mr-spent">
            <div><small>Paid · {period}</small><div className="big">{money(total)}</div><small>{list.length} payment{list.length === 1 ? "" : "s"}</small></div>
            <div className="mr-spent-cats">{Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}>{k}: <b>{money(v)}</b></span>)}</div>
          </div>
          {list.length === 0 && <p className="mr-note">No payments match.</p>}
          {list.slice(0, show).map((p) => (
            <div className="mr-inv" key={p.id}>
              <div style={{ minWidth: 0 }}>
                {p.description || p.invoice_number}
                <small>{day(p.received_at)} · {METHOD[p.method] || p.method} · {p.invoice_number}</small>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="mr-money">{money(p.amount)}</div>
                <a href={`/marina/account/receipt/${p.id}`} style={{ fontSize: 13 }}>Receipt (PDF)</a>
              </div>
            </div>
          ))}
          {list.length > show && <div style={{ textAlign: "center", marginTop: 10 }}><button className="mr-btn ghost" onClick={() => setShow(show + 25)}>Show more ({list.length - show})</button></div>}
        </>
      )}
    </div>
  );
}
