"use client";

import { useEffect, useState } from "react";

// Oct 26 (per Mely — work orders): the boater's service work in Boater login — estimates to
// approve, work in the shop, and finished jobs.
type W = { number: string; title: string; status: string; boat: string | null; total: number | null; link: string | null; due_date: string | null };
const LABEL: Record<string, [string, string]> = {
  awaiting_approval: ["Needs your approval", "#b45309"], approved: ["Approved", "#0369a1"], in_progress: ["In the shop", "#0369a1"], waiting_parts: ["Waiting for parts", "#b45309"],
  completed: ["Done", "#047857"], invoiced: ["Done — invoiced", "#047857"], declined: ["Declined", "#64748b"], cancelled: ["Cancelled", "#64748b"],
};

export default function WorkOrdersCard() {
  const [list, setList] = useState<W[]>([]);
  useEffect(() => { fetch("/api/marina/work-order", { cache: "no-store" }).then((x) => x.json()).then((r) => setList(r.workOrders || [])).catch(() => {}); }, []);
  if (!list.length) return null;
  const waiting = list.filter((w) => w.status === "awaiting_approval");
  return (
    <div className="mr-card" style={waiting.length ? { borderColor: "#f59e0b", boxShadow: "0 0 0 2px #fde68a" } : undefined}>
      <h3 style={{ margin: 0 }}>Service & repairs{waiting.length ? ` · ${waiting.length} to approve` : ""}</h3>
      {list.map((w) => {
        const [label, color] = LABEL[w.status] || [w.status, "#64748b"];
        return (
          <div key={w.number} className="mr-inv">
            <div style={{ minWidth: 0 }}>
              {w.title}
              <small>{w.number}{w.boat ? ` · ${w.boat}` : ""}{w.due_date ? ` · ready by ${new Date(`${w.due_date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}` : ""}</small>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {w.total != null && <div className="mr-money">${Number(w.total).toFixed(2)}</div>}
              <small style={{ fontWeight: 700, color }}>{label}</small>
              {w.link && <a href={w.link} style={{ display: "block", fontSize: 13, fontWeight: 700, marginTop: 2 }}>{w.status === "awaiting_approval" ? "Review & approve" : "View"}</a>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
