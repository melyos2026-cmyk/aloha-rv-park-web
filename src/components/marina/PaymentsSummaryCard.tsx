"use client";

import { MARINA_CATEGORY } from "@/lib/marina/labels";

// Oct 23 (per Mely): a short preview in Boater login (like the RV portal cards). The full
// history, receipts and printable statements are on their own page.
type P = { id: string; description: string; category: string; amount: number; received_at: string };
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function PaymentsSummaryCard({ payments }: { payments: P[] }) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = payments.filter((p) => p.received_at.startsWith(ym)).reduce((a, p) => a + p.amount, 0);
  const year = payments.filter((p) => p.received_at.startsWith(String(now.getFullYear()))).reduce((a, p) => a + p.amount, 0);
  const last = [...payments].sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
  return (
    <a className="mr-card mr-preview" href="/marina/account/statements">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Payments &amp; statements</h3>
        <span className="mr-preview-go" aria-hidden>›</span>
      </div>
      <div className="mr-preview-stats">
        <div><small>This month</small><b>{money(month)}</b></div>
        <div><small>This year</small><b>{money(year)}</b></div>
        <div><small>Payments</small><b>{payments.length}</b></div>
      </div>
      {last ? (
        <p className="mr-note" style={{ margin: 0 }}>Last payment: <b>{money(last.amount)}</b> on {day(last.received_at)} · {MARINA_CATEGORY[last.category] || "Payment"}</p>
      ) : <p className="mr-note" style={{ margin: 0 }}>No payments yet.</p>}
      <span className="mr-preview-link">See all payments, receipts and statements →</span>
    </a>
  );
}
