"use client";

import { useEffect, useRef, useState } from "react";
import type { StoreItem } from "@/lib/marina/data";

// Oct 23 (per Mely): online-shop style store page. Category chips, search, photo cards,
// "Load more" for big catalogs, and a detail window for each item.
const money = (n: number) => "$" + n.toFixed(2);

export default function MarinaStore({ name, tagline, categories, initial }: {
  name: string; tagline: string; categories: { name: string; count: number }[]; initial: { items: StoreItem[]; total: number };
}) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<StoreItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<StoreItem | null>(null);
  const first = useRef(true);

  async function load(nextPage: number, append: boolean) {
    setBusy(true);
    const u = new URLSearchParams({ page: String(nextPage) });
    if (cat !== "All") u.set("cat", cat);
    if (q.trim()) u.set("q", q.trim());
    const r = await fetch(`/api/marina/store?${u}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ items: [], total: 0 }));
    setItems((prev) => (append ? [...prev, ...(r.items || [])] : r.items || []));
    setTotal(r.total || 0); setPage(nextPage); setBusy(false);
  }
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => load(0, false), 250);
    return () => clearTimeout(t);
  }, [cat, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = categories.reduce((n, c) => n + c.count, 0);
  const chip = (label: string, count: number) => (
    <button key={label} type="button" onClick={() => setCat(label)} className="mr-store-chip" aria-pressed={cat === label}>
      {label} <span>{count}</span>
    </button>
  );

  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 56px" }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>{name}</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>{tagline} Members can charge purchases to their account. Prices before sales tax.</p>

      <input className="mr-store-search" placeholder={`Search ${name}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the store" />
      <div className="mr-store-chips" role="group" aria-label="Categories">
        {chip("All", all)}
        {categories.map((c) => chip(c.name, c.count))}
      </div>

      {!busy && items.length === 0 && <p className="mr-note">Nothing found. Try another word or category.</p>}
      <div className="mr-store-grid">
        {items.map((i) => (
          <button key={i.id} type="button" className="mr-store-card" onClick={() => setOpen(i)}>
            <div className="mr-store-img">{i.photo ? <img src={i.photo} alt="" loading="lazy" /> : <span aria-hidden>{i.name.slice(0, 1)}</span>}</div>
            <div className="mr-store-body">
              <div className="mr-store-name">{i.name}</div>
              <div className="mr-store-cat">{i.category}</div>
              <div className="mr-store-price">{i.soldOut ? <span className="mr-overdue">Sold out</span> : money(i.price)}</div>
            </div>
          </button>
        ))}
      </div>
      {items.length < total && (
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <button className="mr-btn dark" disabled={busy} onClick={() => load(page + 1, true)}>{busy ? "Loading…" : `Show more (${total - items.length} more)`}</button>
        </div>
      )}

      {open && (
        <div role="dialog" aria-modal="true" onClick={() => setOpen(null)} className="mr-store-modal">
          <div onClick={(e) => e.stopPropagation()} className="mr-store-sheet">
            {open.photo && <img src={open.photo} alt="" style={{ width: "100%", maxHeight: 340, objectFit: "cover", display: "block", borderRadius: "14px 14px 0 0" }} />}
            <div style={{ padding: 18, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <h3 style={{ margin: 0 }}>{open.name}</h3>
                <button type="button" aria-label="Close" onClick={() => setOpen(null)} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
              <div className="mr-store-price" style={{ fontSize: 20 }}>{open.soldOut ? "Sold out" : money(open.price)}</div>
              <div className="mr-note" style={{ margin: 0 }}>{open.category}</div>
              {open.description && <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{open.description}</p>}
              <p className="mr-note" style={{ margin: "6px 0 0" }}>Available at the store on the dock. Members can charge it to their account.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
