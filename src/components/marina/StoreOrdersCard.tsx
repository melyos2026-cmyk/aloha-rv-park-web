"use client";

import { useEffect, useState } from "react";

// Oct 23 (per Mely): the boater's own store orders in Boater login, with their status.
type O = { order_number: string; created_at: string; lines: { name: string; qty: number }[]; total: number; fulfillment: string; slip_name: string | null; wanted_at: string | null; payment: string; status: string };
const STATUS: Record<string, string> = { placed: "Received", ready: "Ready", completed: "Done", cancelled: "Cancelled" };

export default function StoreOrdersCard() {
  const [orders, setOrders] = useState<O[]>([]);
  const [name, setName] = useState("Ship Store");
  const [online, setOnline] = useState(false);
  useEffect(() => {
    fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((r) => { setOrders(r.orders || []); setName(r.storeName || "Ship Store"); setOnline(!!r.online); }).catch(() => {});
  }, []);
  if (!online && orders.length === 0) return null;
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{name} orders</h3>
        <a className="mr-btn ghost" href="/marina/store">Shop</a>
      </div>
      {orders.length === 0 && <p className="mr-note" style={{ marginTop: 8 }}>Order ice, drinks, bait and supplies online. Pick them up or we bring them to your slip.</p>}
      {orders.map((o) => (
        <div key={o.order_number} className="mr-inv">
          <div style={{ minWidth: 0 }}>
            {o.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}
            <small>{o.order_number} · {o.fulfillment === "slip" ? `to slip ${o.slip_name}` : "pickup"}{o.wanted_at ? ` · ${o.wanted_at}` : ""} · {o.payment === "account" ? "charged to account" : "card"}</small>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className="mr-money">${Number(o.total).toFixed(2)}</div>
            <small style={{ fontWeight: 700, color: o.status === "ready" ? "#0369a1" : o.status === "completed" ? "#047857" : o.status === "cancelled" ? "#64748b" : "#b45309" }}>{STATUS[o.status] || o.status}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
