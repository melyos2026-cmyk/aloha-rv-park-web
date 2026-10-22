"use client";

import { useEffect, useMemo, useState } from "react";

// Oct 22 (per Mely): public Marketplace of this marina. Items posted by boaters (reviewed by
// Mely). Buyers write to the seller through a form; the seller's email/phone are never shown.
type L = { id: string; title: string; description: string | null; price: number | null; category: string | null; created_at: string; photos: string[]; seller: string };
const money = (n: number | null) => (n == null ? "Make an offer" : n === 0 ? "Free" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));

export default function MarinaMarketplace({ marinaName }: { marinaName: string }) {
  const [list, setList] = useState<L[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<L | null>(null);
  const [photo, setPhoto] = useState(0);
  const [c, setC] = useState({ buyerName: "", buyerEmail: "", buyerPhone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/marina/marketplace", { cache: "no-store" }).then((x) => x.json()).then((r) => { setList(r.listings || []); setCats(r.categories || []); }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const shown = useMemo(() => list.filter((l) => (cat === "All" || l.category === cat) && (!q.trim() || `${l.title} ${l.description || ""}`.toLowerCase().includes(q.trim().toLowerCase()))), [list, cat, q]);

  async function send() {
    if (!open) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/marketplace-contact-seller", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listingId: open.id, ...c }) });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: r.error || "Could not send your message." }); return; }
    setMsg({ ok: true, text: "Sent! The seller will reply to your email." });
    setC({ buyerName: "", buyerEmail: "", buyerPhone: "", message: "" });
  }

  const input = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };
  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 48px" }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>Marketplace</h1>
      <p className="mr-note" style={{ marginTop: 0 }}>Gear and items for sale by boaters at {marinaName}. Have something to sell? <a href="/marina/account">Sign in to your boater account</a>.</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
        <input style={{ ...input, flex: "1 1 220px", width: "auto" }} placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ ...input, flex: "0 1 220px", width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option>All</option>{cats.map((x) => <option key={x}>{x}</option>)}
        </select>
      </div>

      {loaded && shown.length === 0 && <p className="mr-note">No items right now. Check back soon.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
        {shown.map((l) => (
          <button key={l.id} type="button" onClick={() => { setOpen(l); setPhoto(0); setMsg(null); }} className="mr-card" style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", margin: 0 }}>
            {l.photos[0] ? <img src={l.photos[0]} alt="" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} /> : <div style={{ height: 8, background: "#0f2540" }} />}
            <div style={{ padding: "10px 14px 14px" }}>
              <div style={{ fontWeight: 700 }}>{l.title}</div>
              <div style={{ fontWeight: 700, color: "#0f2540", marginTop: 4 }}>{money(l.price)}</div>
              <div className="mr-note" style={{ margin: "4px 0 0", fontSize: 13 }}>{l.category || "Other"} · {l.seller}</div>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <div role="dialog" aria-modal="true" onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(10,20,35,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
            {open.photos.length > 0 && (
              <div>
                <img src={open.photos[photo]} alt="" style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block", borderRadius: "14px 14px 0 0" }} />
                {open.photos.length > 1 && <div style={{ display: "flex", gap: 6, padding: "8px 12px", overflowX: "auto" }}>{open.photos.map((p, i) => <img key={p} src={p} alt="" onClick={() => setPhoto(i)} style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, cursor: "pointer", outline: i === photo ? "2px solid #0f2540" : "none" }} />)}</div>}
              </div>
            )}
            <div style={{ padding: 18, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <h3 style={{ margin: 0 }}>{open.title}</h3>
                <button type="button" aria-label="Close" onClick={() => setOpen(null)} style={{ background: "none", border: 0, fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
              </div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{money(open.price)}</div>
              <div className="mr-note" style={{ margin: 0 }}>{open.category || "Other"} · Seller: {open.seller}</div>
              {open.description && <p style={{ whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.55 }}>{open.description}</p>}
              <h4 style={{ margin: "8px 0 0" }}>Contact the seller</h4>
              <input style={input} placeholder="Your name" value={c.buyerName} onChange={(e) => setC({ ...c, buyerName: e.target.value })} />
              <input style={input} type="email" placeholder="Your email" value={c.buyerEmail} onChange={(e) => setC({ ...c, buyerEmail: e.target.value })} />
              <input style={input} type="tel" placeholder="Phone (optional)" value={c.buyerPhone} onChange={(e) => setC({ ...c, buyerPhone: e.target.value })} />
              <textarea style={input} rows={3} placeholder="Hi, is this still available?" value={c.message} onChange={(e) => setC({ ...c, message: e.target.value })} />
              {msg && <div className={msg.ok ? "mr-ok" : "mr-error"} role="status">{msg.text}</div>}
              <button className="mr-btn dark" disabled={busy || !c.buyerName.trim() || !c.buyerEmail.trim() || !c.message.trim()} onClick={send}>{busy ? "Sending…" : "Send message"}</button>
              <p className="mr-note" style={{ margin: 0, fontSize: 12.5 }}>Meet in a public place at the marina. The marina is not part of the sale.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
