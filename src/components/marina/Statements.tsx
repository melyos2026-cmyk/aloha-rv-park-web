"use client";

import { useMemo, useState } from "react";
import { MARINA_CATEGORY, MARINA_METHOD } from "@/lib/marina/labels";

// Oct 23 (per Mely): bank-statement style page. Filter by year / month / search; payments are
// grouped by month with each month's total; every payment opens its receipt (PDF); "Print
// statement" prints exactly what is filtered, with the marina's header.
type P = { id: string; invoice_number: string; description: string; category: string; amount: number; method: string; received_at: string };
type Inv = { id: string; number: string; description: string; due: string; balance: number; overdue: boolean };
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Statements({ company, member, payments, openInvoices }: {
  company: { name: string; address: string | null; phone: string | null; email: string | null; logo: string | null; domain: string };
  member: { name: string; email: string | null };
  payments: P[]; openInvoices: Inv[];
}) {
  const years = useMemo(() => Array.from(new Set(payments.map((p) => p.received_at.slice(0, 4)))).sort().reverse(), [payments]);
  const [year, setYear] = useState(years[0] || "all");
  const [month, setMonth] = useState("all");
  const [cat, setCat] = useState("all");
  // Oct 23 (per Mely): also by day — pick one date and print just that day.
  const [dayPick, setDayPick] = useState("");
  const [q, setQ] = useState("");
  // Oct 23 (per Mely): each month is a card that opens and closes; the newest month starts open.
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const toggle = (ym: string, def: boolean) => setOpenMonths((m) => ({ ...m, [ym]: !(m[ym] ?? def) }));
  const [printing, setPrinting] = useState(false);
  // When printing, every month is shown open so the statement is complete.
  function printAll() { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 150); }

  const list = useMemo(() => payments
    .filter((p) => year === "all" || p.received_at.startsWith(year))
    .filter((p) => month === "all" || p.received_at.slice(5, 7) === month)
    .filter((p) => !dayPick || p.received_at === dayPick)
    .filter((p) => cat === "all" || p.category === cat)
    .filter((p) => { const t = q.trim().toLowerCase(); return !t || `${p.invoice_number} ${p.description} ${MARINA_CATEGORY[p.category] || ""} ${p.amount.toFixed(2)}`.toLowerCase().includes(t); })
    .sort((a, b) => b.received_at.localeCompare(a.received_at)), [payments, year, month, cat, q]);
  const groups = useMemo(() => {
    const m = new Map<string, P[]>();
    list.forEach((p) => { const k = p.received_at.slice(0, 7); (m.get(k) || m.set(k, []).get(k)!).push(p); });
    return Array.from(m.entries());
  }, [list]);
  const total = list.reduce((a, p) => a + p.amount, 0);
  const byCat = list.reduce<Record<string, number>>((m, p) => { const k = MARINA_CATEGORY[p.category] || "Other"; m[k] = (m[k] || 0) + p.amount; return m; }, {});
  const cats = Array.from(new Set(payments.map((p) => p.category)));
  const period = dayPick ? day(dayPick) : year === "all" ? "All time" : month === "all" ? `Year ${year}` : `${MONTHS[Number(month) - 1]} ${year}`;
  const input = { padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, background: "#fff", boxSizing: "border-box" as const };

  return (
    <div className="mr-doc-page">
      <div className="mr-doc-actions">
        <a className="mr-btn ghost" href="/marina/account">← My account</a>
        <button className="mr-btn dark" onClick={printAll}>Print statement / PDF</button>
      </div>

      <div className="mr-noprint" style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <h1 className="mr-h2" style={{ margin: 0 }}>Payments &amp; statements</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select style={input} value={year} onChange={(e) => { setYear(e.target.value); if (e.target.value === "all") setMonth("all"); }}>
            <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
          </select>
          <select style={input} value={month} disabled={year === "all"} onChange={(e) => setMonth(e.target.value)}>
            <option value="all">All months</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>)}
          </select>
          <select style={input} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All types</option>{cats.map((c) => <option key={c} value={c}>{MARINA_CATEGORY[c] || c}</option>)}
          </select>
          <input style={{ ...input, flex: "1 1 180px" }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label className="mr-note" style={{ margin: 0 }}>One day:</label>
          <input type="date" style={input} value={dayPick} onChange={(e) => { setDayPick(e.target.value); if (e.target.value) { setYear("all"); setMonth("all"); } }} />
          {dayPick && <button type="button" className="mr-btn ghost" onClick={() => { setDayPick(""); setYear(years[0] || "all"); }}>Clear day</button>}
        </div>
      </div>

      <article className="mr-doc">
        <header className="mr-doc-head">
          <div>
            {company.logo ? <img src={company.logo} alt="" className="mr-doc-logo" /> : null}
            <div className="mr-doc-co">{company.name}</div>
            {company.address && <div className="mr-doc-muted">{company.address}</div>}
            <div className="mr-doc-muted">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mr-doc-title">Statement</div>
            <div className="mr-doc-muted">{period}</div>
            <div className="mr-doc-muted"><b>{member.name}</b></div>
            {member.email && <div className="mr-doc-muted">{member.email}</div>}
          </div>
        </header>

        <div className="mr-spent" style={{ marginTop: 16 }}>
          <div><small>Total paid · {period}</small><div className="big">{money(total)}</div><small>{list.length} payment{list.length === 1 ? "" : "s"}</small></div>
          <div className="mr-spent-cats">{Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k}>{k}: <b>{money(v)}</b></span>)}</div>
        </div>

        {openInvoices.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <div className="mr-doc-label">Open invoices</div>
            <table className="mr-doc-table">
              <tbody>{openInvoices.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}<div className="mr-doc-muted">{i.number} · due {day(i.due)}{i.overdue ? " · overdue" : ""}</div></td>
                  <td className="num"><b>{money(i.balance)}</b><div className="mr-noprint"><a href={`/marina/account/invoice/${i.id}`} style={{ fontSize: 13 }}>View (PDF)</a></div></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}

        {groups.length === 0 && <p className="mr-note" style={{ marginTop: 16 }}>No payments in this period.</p>}
        {groups.map(([ym, rows], idx) => {
          const isOpen = printing || (openMonths[ym] ?? idx === 0);
          return (
          <section key={ym} style={{ marginTop: 14 }} className={isOpen ? "mr-stmt-open" : ""}>
            <button type="button" className="mr-stmt-month" aria-expanded={isOpen} onClick={() => toggle(ym, idx === 0)}>
              <span className="mr-stmt-chev" aria-hidden>{isOpen ? "▾" : "▸"}</span>
              <span style={{ flex: 1 }}>{MONTHS[Number(ym.slice(5, 7)) - 1]} {ym.slice(0, 4)} <small>· {rows.length} payment{rows.length === 1 ? "" : "s"}</small></span>
              <span>{money(rows.reduce((a, p) => a + p.amount, 0))}</span>
            </button>
            {isOpen && (
            <table className="mr-doc-table">
              <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{day(p.received_at)}</td>
                  <td>{p.description || p.invoice_number}<div className="mr-doc-muted">{MARINA_CATEGORY[p.category] || "Payment"} · {MARINA_METHOD[p.method] || p.method} · {p.invoice_number}</div></td>
                  <td className="num"><b>{money(p.amount)}</b><div className="mr-noprint"><a href={`/marina/account/receipt/${p.id}`} style={{ fontSize: 13 }}>Receipt</a></div></td>
                </tr>
              ))}</tbody>
            </table>
            )}
          </section>
          );
        })}
        <footer className="mr-doc-foot">{company.name} · {company.domain} · Statement printed {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</footer>
      </article>
    </div>
  );
}
