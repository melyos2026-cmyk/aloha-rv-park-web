"use client";

import { useEffect, useRef, useState } from "react";
import type { StoreItem } from "@/lib/marina/data";
import { kitPrice, kitLineKey } from "@/lib/marina/store-kit";
import PayChoice from "./PayChoice";

// Oct 23 (per Mely): online-shop style store page. Category chips, search, photo cards,
// "Load more" for big catalogs, and a detail window for each item.
const money = (n: number) => "$" + n.toFixed(2);

export default function MarinaStore({ name, tagline, categories, initial, initialCat, initialSub }: {
  name: string; tagline: string; categories: { name: string; count: number; subs?: { name: string; count: number }[] }[]; initial: { items: StoreItem[]; total: number };
  initialCat?: string; initialSub?: string;
}) {
  // Oct 24 (per Mely): no "All" chip — the store opens on its first category; a search looks across every category.
  const [cat, setCatRaw] = useState(initialCat || categories[0]?.name || "All");
  const [subCat, setSubCat] = useState(initialSub || "");
  const subsOf = (c: string) => categories.find((x) => x.name === c)?.subs || [];
  const setCat = (c: string) => { setCatRaw(c); setSubCat(subsOf(c)[0]?.name || ""); };
  const subs = subsOf(cat);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<StoreItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<StoreItem | null>(null);
  // Oct 24 (per Mely): build-your-own kit — parts the customer keeps (all of them to start).
  const [keep, setKeep] = useState<string[]>([]);
  // Oct 24 (per Mely): how many to add (ice: 1, 2, 5 bags…) — type it or use − / +.
  const [sheetQty, setSheetQty] = useState(1);
  useEffect(() => { setSheetQty(1); if (open?.kit) setKeep(open.variants.filter((v) => !v.soldOut).map((v) => v.key)); }, [open]);
  const first = useRef(true);
  // Oct 23 (per Mely): online orders — a cart kept in this browser, then checkout.
  type CartLine = { id: string; variant?: string; name: string; price: number; qty: number; photo: string | null };
  const lineKey = (c: { id: string; variant?: string }) => c.id + (c.variant ? "::" + c.variant : "");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [opts, setOpts] = useState<{ signedIn: boolean; member: any; taxRate: number; online: boolean; slipDelivery: boolean; accountAllowed?: boolean; demo?: boolean } | null>(null);
  const [co, setCo] = useState({ name: "", email: "", phone: "", fulfillment: "pickup", slip: "", when: "", notes: "", payment: "card" });
  const [placing, setPlacing] = useState(false);
  const [coErr, setCoErr] = useState("");
  const [done, setDone] = useState<{ order: string; total: number; charged?: boolean; demo?: boolean } | null>(null);
  useEffect(() => {
    try { const c = JSON.parse(localStorage.getItem("mr_cart") || "[]"); if (Array.isArray(c)) setCart(c); } catch {}
    fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((r) => {
      setOpts(r);
      if (r?.member) setCo((c) => ({ ...c, name: r.member.full_name || "", email: r.member.email || "", phone: r.member.phone || "" }));
    }).catch(() => {});
    const u = new URLSearchParams(window.location.search);
    if (u.get("order") && u.get("paid") === "1") { setDone({ order: u.get("order")!, total: 0 }); try { localStorage.removeItem("mr_cart"); } catch {} setCart([]); }
  }, []);
  function saveCart(next: CartLine[]) { setCart(next); try { localStorage.setItem("mr_cart", JSON.stringify(next)); } catch {} }
  function add(i: StoreItem, variantKey?: string, n = 1) {
    // Oct 24: items with choices (Corona / Heineken…) must be added from the sheet with a choice.
    if (i.variants.length && !variantKey) { setOpen(i); return; }
    const v = variantKey ? i.variants.find((x) => x.key === variantKey) : undefined;
    const key = i.id + (v ? "::" + v.key : "");
    const cur = cart.find((c) => lineKey(c) === key);
    saveCart(cur ? cart.map((c) => (lineKey(c) === key ? { ...c, qty: Math.min(99, c.qty + n) } : c)) : [...cart, { id: i.id, variant: v?.key, name: v ? `${i.name} — ${v.name}` : i.name, price: v ? v.price : i.price, qty: Math.min(99, n), photo: i.photo }]);
  }
  function addKit(i: StoreItem, n = 1) {
    if (!keep.length) return;
    const parts = i.variants.filter((v) => keep.includes(v.key));
    const full = parts.length === i.variants.length;
    const variant = kitLineKey(keep);
    const key = i.id + "::" + variant;
    const price = kitPrice(i.price, i.variants, keep);
    const cur = cart.find((c) => lineKey(c) === key);
    saveCart(cur ? cart.map((c) => (lineKey(c) === key ? { ...c, qty: Math.min(99, c.qty + n) } : c)) : [...cart, { id: i.id, variant, name: `${i.name} — ${full ? "complete kit" : parts.map((v) => v.name).join(", ")}`, price, qty: Math.min(99, n), photo: i.photo }]);
  }
  function setQty(key: string, qty: number) { saveCart(qty <= 0 ? cart.filter((c) => lineKey(c) !== key) : cart.map((c) => (lineKey(c) === key ? { ...c, qty: Math.min(99, qty) } : c))); }
  const count = cart.reduce((n, c) => n + c.qty, 0);
  const sub = cart.reduce((n, c) => n + c.qty * c.price, 0);
  async function placeOrder() {
    setPlacing(true); setCoErr("");
    const res = await fetch("/api/marina/store/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...co, lines: cart.map((c) => ({ id: c.id, variant: c.variant, qty: c.qty })), payment: co.payment === "account" && opts?.accountAllowed ? "account" : "card" }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setPlacing(false); setCoErr(r.error || "Could not place your order."); return; }
    if (r.url) { window.location.href = r.url; return; }
    saveCart([]);
    // Oct 24 (per Mely): go to the order page (order number, pickup code, QR, status).
    if (r.token) { window.location.href = `/marina/store/order/${encodeURIComponent(r.order)}?t=${encodeURIComponent(r.token)}&new=1`; return; }
    setPlacing(false); setDone({ order: r.order, total: r.total, charged: !!r.charged, demo: !!r.demo });
  }

  async function load(nextPage: number, append: boolean) {
    setBusy(true);
    const u = new URLSearchParams({ page: String(nextPage) });
    if (cat !== "All" && !q.trim()) u.set("cat", cat);
    if (subCat && !q.trim()) u.set("sub", subCat);
    if (q.trim()) u.set("q", q.trim());
    const r = await fetch(`/api/marina/store?${u}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ items: [], total: 0 }));
    setItems((prev) => (append ? [...prev, ...(r.items || [])] : r.items || []));
    setTotal(r.total || 0); setPage(nextPage); setBusy(false);
  }
  // Oct 24: keep the place in the address so a refresh stays on the same category / sub-category.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (cat && cat !== "All") u.searchParams.set("cat", cat); else u.searchParams.delete("cat");
      if (subCat) u.searchParams.set("sub", subCat); else u.searchParams.delete("sub");
      window.history.replaceState(null, "", u.toString());
    } catch {}
  }, [cat, subCat]);
  useEffect(() => {
    if (first.current) { first.current = false; return; } // the server already loaded this category
    const t = setTimeout(() => load(0, false), 250);
    return () => clearTimeout(t);
  }, [cat, subCat, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (label: string, count: number) => (
    <button key={label} type="button" onClick={() => setCat(label)} className="mr-store-chip" aria-pressed={cat === label}>
      {label} <span>{count}</span>
    </button>
  );

  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 56px" }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>{name}</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>{tagline}{opts?.accountAllowed ? " Members can charge purchases to their account." : ""} Prices before sales tax.</p>

      <input className="mr-store-search" placeholder={`Search ${name}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the store" />
      <div className="mr-store-chips" role="group" aria-label="Categories">
        {categories.map((c) => chip(c.name, c.count))}
      </div>
      {subs.length > 0 && !q.trim() && (
        <div className="mr-store-chips mr-store-subs" role="group" aria-label="Sub-categories">
          {subs.map((x) => <button key={x.name} type="button" className="mr-store-chip" aria-pressed={subCat === x.name} onClick={() => setSubCat(x.name)}>{x.name} <span>{x.count}</span></button>)}
        </div>
      )}

      {!busy && items.length === 0 && <p className="mr-note">Nothing found. Try another word or category.</p>}
      <div className="mr-store-grid">
        {items.map((i) => (
          <button key={i.id} type="button" className="mr-store-card" onClick={() => setOpen(i)}>
            <div className="mr-store-img">{i.photo ? <img src={i.photo} alt="" loading="lazy" /> : <span aria-hidden>{i.name.slice(0, 1)}</span>}</div>
            <div className="mr-store-body">
              <div className="mr-store-name">{i.name}</div>
              <div className="mr-store-cat">{i.category}</div>
              <div className="mr-store-price">{i.soldOut ? <span className="mr-overdue">Sold out</span> : i.variants.length && !i.kit ? `from ${money(i.price)}` : money(i.price)}</div>
            </div>
            {opts?.online && !i.soldOut && (
              <span role="button" tabIndex={0} className="mr-store-add" onClick={(e) => { e.stopPropagation(); add(i); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); add(i); } }}>
                {i.kit ? "Build your kit" : i.variants.length ? "Choose" : cart.find((c) => c.id === i.id) ? `In cart (${cart.find((c) => c.id === i.id)!.qty}) · Add` : "Add to cart"}
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
              {opts?.online && !open.soldOut && (
                <div className="mr-sheet-qty">
                  <span>How many?</span>
                  <span className="mr-qty">
                    <button type="button" aria-label="Less" onClick={() => setSheetQty(Math.max(1, sheetQty - 1))}>−</button>
                    <input type="number" inputMode="numeric" min={1} max={99} aria-label="Quantity" value={sheetQty} onChange={(e) => setSheetQty(Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))))} onFocus={(e) => e.target.select()} />
                    <button type="button" aria-label="More" onClick={() => setSheetQty(Math.min(99, sheetQty + 1))}>+</button>
                  </span>
                </div>
              )}
              {open.kit && (() => {
                const parts = open.variants;
                const sum = parts.filter((v) => keep.includes(v.key)).reduce((a, v) => a + v.price, 0);
                const price = kitPrice(open.price, parts, keep);
                const full = keep.length === parts.length;
                return (
                  <div className="mr-variants">
                    <div className="mr-note" style={{ margin: 0 }}>Keep everything for the full-kit price, or uncheck what you don&apos;t need and pay only for what you keep.</div>
                    {parts.map((v) => (
                      <label key={v.key} className="mr-variant mr-kit-part">
                        <input type="checkbox" disabled={v.soldOut} checked={keep.includes(v.key)} onChange={(e) => setKeep(e.target.checked ? [...keep, v.key] : keep.filter((k) => k !== v.key))} />
                        <span className="mr-variant-name">{v.name}</span>
                        <span className="mr-variant-price">{v.soldOut ? <span className="mr-overdue">Sold out</span> : money(v.price)}</span>
                      </label>
                    ))}
                    <div className="mr-kit-total">
                      <span>{full ? "Complete kit" : `${keep.length} of ${parts.length} items`}</span>
                      <b>{money(price)}</b>
                    </div>
                    {full && sum > price && <div className="mr-note" style={{ margin: 0 }}>You save {money(sum - price)} with the complete kit.</div>}
                    {opts?.online
                      ? <button className="mr-btn dark" disabled={!keep.length} onClick={() => { addKit(open, sheetQty); setOpen(null); }}>{keep.length ? `Add ${sheetQty > 1 ? sheetQty + " " : ""}to cart · ${money(price * sheetQty)}` : "Choose at least one item"}</button>
                      : <p className="mr-note" style={{ margin: "6px 0 0" }}>Available at the store on the dock.</p>}
                  </div>
                );
              })()}
              {open.variants.length > 0 && !open.kit && (
                <div className="mr-variants">
                  {open.variants.map((v) => {
                    const inCart = cart.find((c) => c.id === open.id && c.variant === v.key);
                    return (
                      <div key={v.key} className="mr-variant">
                        <span className="mr-variant-name">{v.name}</span>
                        <span className="mr-variant-price">{v.soldOut ? <span className="mr-overdue">Sold out</span> : money(v.price)}</span>
                        {opts?.online && !v.soldOut && <button type="button" className="mr-btn" onClick={() => add(open, v.key, sheetQty)}>{sheetQty > 1 ? `Add ${sheetQty}` : "Add"}{inCart ? ` · ${inCart.qty} in cart` : ""}</button>}
                      </div>
                    );
                  })}
                </div>
              )}
              {open.kit ? null : open.variants.length > 0
                ? (opts?.online ? <button className="mr-btn ghost" onClick={() => setOpen(null)}>Done</button> : <p className="mr-note" style={{ margin: "6px 0 0" }}>Available at the store on the dock.</p>)
                : opts?.online && !open.soldOut
                ? <button className="mr-btn dark" onClick={() => { add(open, undefined, sheetQty); setOpen(null); }}>Add {sheetQty > 1 ? `${sheetQty} ` : ""}to cart · {money(open.price * sheetQty)}</button>
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
              <div key={lineKey(c)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>{c.name}<div className="mr-note" style={{ margin: 0, fontSize: 13 }}>{money(c.price)} each</div></div>
                <div className="mr-qty">
                  <button type="button" onClick={() => setQty(lineKey(c), c.qty - 1)} aria-label="One less">−</button>
                  <span>{c.qty}</span>
                  <button type="button" onClick={() => setQty(lineKey(c), c.qty + 1)} aria-label="One more">+</button>
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
                <PayChoice value={co.payment} onChange={(v) => setCo({ ...co, payment: v })} signedIn={!!opts?.signedIn} accountAllowed={!!opts?.accountAllowed} demo={!!opts?.demo} payLabel="Pay by card now" />
                {coErr && <div className="mr-error" role="alert">{coErr}</div>}
                <button className="mr-btn dark" disabled={placing} onClick={placeOrder}>{placing ? "Placing your order…" : co.payment === "account" && opts?.signedIn && opts?.accountAllowed ? "Place order" : "Continue to payment"}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
