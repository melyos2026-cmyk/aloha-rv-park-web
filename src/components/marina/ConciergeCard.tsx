"use client";

import { useEffect, useState } from "react";

// Oct 23 (per Mely): the boater's concierge requests in Boater login (with quotes to approve).
type R = { id: string; request_number: string; wanted_at: string; units: number; slip_name: string | null; choices?: string | null; quoted_price: number | null; total: number | null; status: string; assigned_name: string | null; service: string; category: string; pricing: string };
const STATUS: Record<string, string> = { requested: "Requested", quoted: "Quote ready", confirmed: "Confirmed", in_progress: "In progress", done: "Done", cancelled: "Cancelled" };
const when = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ConciergeCard() {
  const [list, setList] = useState<R[] | null>(null);
  const load = () => fetch("/api/marina/concierge?mine=1", { cache: "no-store" }).then((x) => x.json()).then((r) => setList(r.requests || [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  async function approve(id: string, ok: boolean) {
    await fetch("/api/marina/concierge/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, approve: ok }) });
    load();
  }
  if (list === null) return null;
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Concierge</h3>
        <a className="mr-btn ghost" href="/marina/concierge">Request</a>
      </div>
      {list.length === 0 && <p className="mr-note" style={{ marginTop: 8 }}>Ice, drinks, provisions, catering, boat cleaning or crew — brought to your slip.</p>}
      {list.map((r) => (
        <div key={r.id} className="mr-inv mr-mkt-row">
          <div className="mr-mkt-info" style={{ display: "block" }}>
            {r.service}{r.units > 1 ? ` × ${r.units}` : ""}{r.choices ? ` — ${r.choices}` : ""}
            <small>{when(r.wanted_at)}{r.slip_name ? ` · slip ${r.slip_name}` : ""} · {r.request_number}{r.assigned_name ? ` · ${r.assigned_name}` : ""}</small>
          </div>
          <div className="mr-mkt-actions" style={{ alignItems: "center" }}>
            {r.status === "quoted" && r.quoted_price != null ? (
              <>
                <b>${Number(r.total ?? r.quoted_price).toFixed(2)}</b>
                <button type="button" className="mr-btn" onClick={() => approve(r.id, true)}>Approve</button>
                <button type="button" className="mr-btn ghost" onClick={() => approve(r.id, false)}>Decline</button>
              </>
            ) : (
              <div style={{ textAlign: "right" }}>
                <div className="mr-money">{r.total != null ? `$${Number(r.total).toFixed(2)}` : "—"}</div>
                <small style={{ fontWeight: 700, color: r.status === "confirmed" || r.status === "done" ? "#047857" : r.status === "cancelled" ? "#64748b" : "#b45309" }}>{STATUS[r.status] || r.status}</small>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
