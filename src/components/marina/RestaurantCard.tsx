"use client";

import { useEffect, useState } from "react";

// Oct 24 (per Mely): the boater's table reservations, inside Boater login.
type R = { id: string; reservation_number: string; reserved_at: string; party_size: number; status: string; notes: string | null };
const LABEL: Record<string, string> = { requested: "Waiting for confirmation", confirmed: "Confirmed", seated: "Seated", completed: "Completed", no_show: "No show", cancelled: "Cancelled" };
const when = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function RestaurantCard({ name }: { name: string }) {
  const [list, setList] = useState<R[]>([]);
  useEffect(() => { fetch("/api/marina/restaurant?mine=1", { cache: "no-store" }).then((x) => x.json()).then((j) => setList(j.reservations || [])).catch(() => {}); }, []);
  const upcoming = list.filter((r) => new Date(r.reserved_at).getTime() > Date.now() - 3 * 3600 * 1000 && !["cancelled", "no_show", "completed"].includes(r.status));
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{name}</h3>
        <a className="mr-btn ghost" href="/marina/restaurant#reserve">Reserve a table</a>
      </div>
      {upcoming.length === 0 ? <p className="mr-note" style={{ marginTop: 8 }}>No upcoming reservations. See the menu and reserve from the Restaurant page.</p> : upcoming.map((r) => (
        <div key={r.id} className="mr-inv"><div>{when(r.reserved_at)} · party of {r.party_size}<small>{LABEL[r.status] || r.status} · {r.reservation_number}{r.notes ? ` · ${r.notes}` : ""}</small></div></div>
      ))}
    </div>
  );
}
