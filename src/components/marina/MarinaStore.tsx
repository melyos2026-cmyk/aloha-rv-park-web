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
  // Oct 23 (per Mely): online orders — a cart kept in this browser, then checkout.
  type CartLine = { id: string; name: string; price: number; qty: number; photo: string | null };
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [opts, setOpts] = useState<{ signedIn: boolean; member: any; taxRate: number; online: boolean; slipDelivery: boolean } | null>(null);
  const [co, setCo] = useState({ name: "", email: "", phone: "", fulfillment: "pickup", slip: "", when: "", notes: "", payment: "card" });
  const [placing, setPlacing] = useState(false);
  const [coErr, setCoErr] = useState("");
  const [done, setDone] = useState<{ order: string; total: number; charged?: boolean; demo?: boolean } | null>(null);
  useEffect(() => {
    try { const c = JSON.parse(localStorage.getItem("mr_cart") || "[]"); if (Array.isArray(c)) setCart(c); } catch {}
    fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((r) => {
      setOpts(r);
      if (r?.member) setCo((c) => ({ ...c, name: r.member.full_name || "", email: r.member.email || "", phone: r.member.phone || "", payment: "account" }));
    }).catch(() => {});
    const u = new URLSearchParams(window.location.search);
    if (u.get("order") && u.get("paid") === "1") { setDone({ order: u.get("order")!, total: 0 }); try { localStorage.removeItem("mr_cart"); } catch {} setCart([]); }
  }, []);
  function saveCart(next: CartLine[]) { setCart(next); try { localStorage.setItem("mr_cart", JSON.stringify(next)); } catch {} }
  function add(i: StoreItem) {
    const cur = cart.find((c) => c.id === i.id);
    saveCart(cur ? cart.map((c) => (c.id === i.id ? { ...c, qty: Math.min(99, c.qty + 1) } : c)) : [...cart, { id: i.id, name: i.name, price: i.price, qty: 1, photo: i.photo }]);
  }
  function setQty(id: string, qty: number) { saveCart(qty <= 0 ? cart.filter((c) => c.id !== id) : cart.map((c) => (c.id === id ? { ...c, qty: Math.min(99, qty) } : c))); }
  const count = cart.reduce((n, c) => n + c.qty, 0);
  const sub = cart.reduce((n, c) => n + c.qty * c.price, 0);
  async function placeOrder() {
    setPlacing(true); setCoErr("");
    const res = await fetch("/api/marina/store/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...co, lines: cart.map((c) => ({ id: c.id, qty: c.qty })) }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setPlacing(false); setCoErr(r.error || "Could not place your order."); return; }
    if (r.url) { window.location.href = r.url; return; }
    setPlacing(false); saveCart([]); setDone({ order: r.order, total: r.total, charged: !!r.charged, demo: !!r.demo });
  }

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
            {opts?.online && !i.soldOut && (
              <span role="button" tabIndex={0} className="mr-store-add" onClick={(e) => { e.stopPropagation(); add(i); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); add(i); } }}>
                {cart.find((c) => c.id === i.id) ? `In cart (${cart.find((c) => c.id === i.id)!.qty}) · Add` : "Add to cart"}
              </span>
            )}
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
              {opts?.online && !open.soldOut
                ? <button className="mr-btn dark" onClick={() => { add(open); setOpen(null); }}>Add to cart</button>
                : <p className="mr-note" style={{ margin: "6px 0 0" }}>Available at the store on the dock.</p>}
            </div>
          </div>
        </div>
      )}
      {done && (
        <div className="mr-store-modal" onClick={() => setDone(null)}>
          <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()} style={{ padding: 22, textAlign: "center" }}>
            <h3 style={{ marginTop: 0 }}>Thank you! Your order is in.</h3>
            <p style={{ margin: "6px 0" }}>Order <b>{done.order}</b>{done.total ? <> · <b>{money(done.total)}</b></> : null}</p>
            <p className="mr-note">{done.charged ? "It was charged to your boater account." : done.demo ? "Demo: no card was charged." : "Your payment was received."} The store has your order and will have it ready.</p>
            <button className="mr-btn dark" onClick={() => setDone(null)}>Keep shopping</button>
          </div>
        </div>
      )}
      {count > 0 && !cartOpen && (
        <button type="button" className="mr-cart-fab" onClick={() => setCartOpen(true)}>Cart · {count} · {money(sub)}</button>
      )}
      {cartOpen && (
        <div className="mr-store-modal" onClick={() => setCartOpen(false)}>
          <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()} style={{ padding: 18, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Your order</h3>
              <button type="button" aria-label="Close" onClick={() => setCartOpen(false)} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer" }}>×</button>
            </div>
            {cart.length === 0 && <p className="mr-note">Your cart is empty.</p>}
            {cart.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>{c.name}<div className="mr-note" style={{ margin: 0, fontSize: 13 }}>{money(c.price)} each</div></div>
                <div className="mr-qty">
                  <button type="button" onClick={() => setQty(c.id, c.qty - 1)} aria-label="One less">−</button>
                  <span>{c.qty}</span>
                  <button type="button" onClick={() => setQty(c.id, c.qty + 1)} aria-label="One more">+</button>
                </div>
              </div>
            ))}
            {cart.length > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}><span>Subtotal</span><span>{money(sub)}</span></div>
                {!!opts?.taxRate && <div className="mr-note" style={{ margin: 0 }}>Sales tax ({opts.taxRate}%) is added on taxable items.</div>}
                <div className="mr-seg">
                  <button type="button" aria-pressed={co.fulfillment === "pickup"} onClick={() => setCo({ ...co, fulfillment: "pickup" })}>Pick up at the store</button>
                  {opts?.slipDelivery && <button type="button" aria-pressed={co.fulfillment === "slip"} onClick={() => setCo({ ...co, fulfillment: "slip" })}>Bring it to my slip</button>}
                </div>
                {co.fulfillment === "slip" && <input className="mr-store-search" style={{ margin: 0 }} placeholder="Slip number (e.g. B2)" value={co.slip} onChange={(e) => setCo({ ...co, slip: e.target.value })} />}
                <input className="mr-store-search" style={{ margin: 0 }} placeholder="When? (e.g. Today 3 PM, Saturday 8 AM)" value={co.when} onChange={(e) => setCo({ ...co, when: e.target.value })} />
                {!opts?.signedIn && (
                  <>
                    <input className="mr-store-search" style={{ margin: 0 }} placeholder="Your name" value={co.name} onChange={(e) => setCo({ ...co, name: e.target.value })} />
                    <input className="mr-store-search" style={{ margin: 0 }} type="email" placeholder="Email for your receipt" value={co.email} onChange={(e) => setCo({ ...co, email: e.target.value })} />
                    <input className="mr-store-search" style={{ margin: 0 }} type="tel" placeholder="Phone (optional)" value={co.phone} onChange={(e) => setCo({ ...co, phone: e.target.value })} />
                  </>
                )}
                <textarea className="mr-store-search" style={{ margin: 0 }} rows={2} placeholder="Notes (optional)" value={co.notes} onChange={(e) => setCo({ ...co, notes: e.target.value })} />
                {opts?.signedIn ? (
                  <div className="mr-seg">
                    <button type="button" aria-pressed={co.payment === "account"} onClick={() => setCo({ ...co, payment: "account" })}>Charge to my account</button>
                    <button type="button" aria-pressed={co.payment === "card"} onClick={() => setCo({ ...co, payment: "card" })}>Pay by card now</button>
                  </div>
                ) : (
                  <p className="mr-note" style={{ margin: 0 }}>Boaters can <a href="/marina/account">sign in</a> to charge it to their account.</p>
                )}
                {coErr && <div className="mr-error" role="alert">{coErr}</div>}
                <button className="mr-btn dark" disabled={placing} onClick={placeOrder}>{placing ? "Placing your order…" : co.payment === "account" && opts?.signedIn ? "Place order" : "Continue to payment"}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
