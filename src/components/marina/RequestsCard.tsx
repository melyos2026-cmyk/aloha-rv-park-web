"use client";
import { useEffect, useState } from "react";

// Oct 26 (per Mely): the boater's slip requests and where each one is.
type R = { number: string; status: string; stay: string; start: string; end: string; boat: string | null; link: string };
const LABEL: Record<string, [string, string]> = {
  requested: ["Office reviewing", "#b45309"], contract_sent: ["Contract ready to sign", "#0369a1"], signed: ["Pay the deposit", "#b45309"], confirmed: ["Confirmed", "#047857"], declined: ["Not available", "#64748b"], cancelled: ["Cancelled", "#64748b"],
};
export default function RequestsCard() {
  const [list, setList] = useState<R[]>([]);
  useEffect(() => { fetch("/api/marina/slip-request", { cache: "no-store" }).then((r) => r.json()).then((j) => setList(j.requests || [])).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <div className="mr-card">
      <h3 style={{ margin: 0 }}>Slip requests</h3>
      {list.map((r) => {
        const [l, c] = LABEL[r.status] || [r.status, "#64748b"];
        return (
          <div key={r.number} className="mr-inv">
            <div style={{ minWidth: 0 }}>{r.stay[0].toUpperCase() + r.stay.slice(1)} slip{r.boat ? ` · ${r.boat}` : ""}<small>{r.number} · {r.start} → {r.end}</small></div>
            <div style={{ textAlign: "right", flexShrink: 0 }}><small style={{ fontWeight: 700, color: c }}>{l}</small><a href={r.link} style={{ display: "block", fontSize: 13, fontWeight: 700, marginTop: 2 }}>Track</a></div>
          </div>
        );
      })}
    </div>
  );
}
