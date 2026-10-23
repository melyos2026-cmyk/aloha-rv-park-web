"use client";

import { useEffect, useState } from "react";

// Oct 23 (per Mely): the boater's rental and experience bookings in Boater login.
type B = { id: string; booking_number: string; starts_at: string; ends_at: string; units: number; people: number | null; total: number; deposit: number; payment: string; status: string; item: string; category: string; kind: string };
const STATUS: Record<string, string> = { requested: "Requested", confirmed: "Confirmed", checked_out: "In use", returned: "Returned", cancelled: "Cancelled", no_show: "No show" };
const when = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function RentalsCard() {
  const [list, setList] = useState<B[] | null>(null);
  useEffect(() => { fetch("/api/marina/rentals?mine=1", { cache: "no-store" }).then((x) => x.json()).then((r) => setList(r.bookings || [])).catch(() => setList([])); }, []);
  if (list === null) return null;
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Rentals &amp; experiences</h3>
        <a className="mr-btn ghost" href="/marina/rentals">Book</a>
      </div>
      {list.length === 0 && <p className="mr-note" style={{ marginTop: 8 }}>Golf carts, boats, kayaks, tours and more — book online and pay here.</p>}
      {list.map((b) => (
        <div key={b.id} className="mr-inv">
          <div style={{ minWidth: 0 }}>
            {b.item}{b.kind === "experience" ? ` · ${b.people || b.units} ${(b.people || b.units) === 1 ? "person" : "people"}` : b.units > 1 ? ` · ${b.units}` : ""}
            <small>{when(b.starts_at)}{b.kind !== "experience" ? ` → ${when(b.ends_at)}` : ""} · {b.booking_number}</small>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="mr-money">${Number(b.total).toFixed(2)}</div>
            <small style={{ fontWeight: 700, color: b.status === "confirmed" ? "#047857" : b.status === "cancelled" || b.status === "no_show" ? "#64748b" : "#b45309" }}>{STATUS[b.status] || b.status}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
