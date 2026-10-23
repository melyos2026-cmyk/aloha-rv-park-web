"use client";

import { useEffect, useMemo, useState } from "react";
import type { Service } from "@/lib/concierge";
import { priceLabel } from "@/lib/concierge";

// Oct 23 (per Mely): Concierge page — pick a service, say when, where (slip) and what; fixed
// prices are charged to the boater's account; "price on request" gets a quote from the office.
const money = (n: number) => "$" + n.toFixed(2);
const localNow = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); d.setMinutes(0, 0, 0); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`; };

export default function MarinaConcierge({ title, intro, services, taxRate, phone }: { title: string; intro: string; services: Service[]; taxRate: number; phone: string | null }) {
  const cats = useMemo(() => Array.from(new Set(services.map((s) => s.category))), [services]);
  const [cat, setCat] = useState("All");
  const [open, setOpen] = useState<Service | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [member, setMember] = useState<any>(null);
  const [done, setDone] = useState<{ request: string; total: number | null; quote: boolean } | null>(null);
  useEffect(() => { fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((r) => { setSignedIn(!!r.signedIn); setMember(r.member || null); }).catch(() => {}); }, []);
  const shown = services.filter((s) => cat === "All" || s.category === cat);

  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 56px" }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>{title}</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>{intro}</p>
      {cats.length > 1 && <div className="mr-store-chips">{["All", ...cats].map((c) => <button key={c} type="button" className="mr-store-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}</div>}
      {shown.length === 0 && <p className="mr-note">Nothing to request online yet{phone ? ` — call ${phone}` : ""}.</p>}
      <div className="mr-store-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {shown.map((s) => (
          <button key={s.id} type="button" className="mr-store-card" onClick={() => setOpen(s)}>
            <div className="mr-store-img" style={{ aspectRatio: "4 / 3" }}>{s.photo ? <img src={s.photo} alt="" loading="lazy" /> : <span aria-hidden>🛎️</span>}</div>
            <div className="mr-store-body">
              <div className="mr-store-cat">{s.category}</div>
              <div className="mr-store-name">{s.name}</div>
              <div className="mr-store-price">{priceLabel(s)}</div>
              <span className="mr-store-add" style={{ margin: "10px 0 0" }}>Request</span>
            </div>
          </button>
        ))}
      </div>
      {open && <RequestSheet s={open} taxRate={taxRate} signedIn={signedIn} member={member} onClose={() => setOpen(null)} onDone={(d) => { setOpen(null); setDone(d); }} />}
      {done && (
        <div className="mr-store-modal" onClick={() => setDone(null)}>
          <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()} style={{ padding: 22, textAlign: "center" }}>
            <h3 style={{ marginTop: 0 }}>Request received</h3>
            <p style={{ margin: "6px 0" }}>Request <b>{done.request}</b>{done.total != null ? <> · <b>{money(done.total)}</b></> : null}</p>
            <p className="mr-note">{done.quote ? "The office will send you a price shortly. You'll see it in your account and nothing is charged until you approve it." : "The office has your request. It will be charged to your account once it's confirmed."}</p>
            <button className="mr-btn dark" onClick={() => setDone(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestSheet({ s, taxRate, signedIn, member, onClose, onDone }: { s: Service; taxRate: number; signedIn: boolean; member: any; onClose: () => void; onDone: (d: any) => void }) {
  const [f, setF] = useState({ wanted_at: localNow(), units: s.min_units, slip: "", boat: "", details: "", name: member?.full_name || "", email: member?.email || "", phone: member?.phone || "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const input = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };
  const isQuote = s.pricing === "quote" || s.price == null;
  const subtotal = isQuote ? null : s.pricing === "fixed" ? s.price! : s.price! * f.units;
  const tax = subtotal != null && s.taxable ? subtotal * taxRate / 100 : 0;
  async function send() {
    setBusy(true); setErr("");
    const res = await fetch("/api/marina/concierge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service: s.id, ...f }) });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(r.error || "Could not send."); return; }
    onDone({ request: r.request, total: r.total, quote: r.quote });
  }
  return (
    <div className="mr-store-modal" onClick={onClose}>
      <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()}>
        {s.photo && <img src={s.photo} alt="" style={{ width: "100%", maxHeight: 240, objectFit: "cover", display: "block", borderRadius: "14px 14px 0 0" }} />}
        <div style={{ padding: 18, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><h3 style={{ margin: 0 }}>{s.name}</h3><button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer" }}>×</button></div>
          <div className="mr-store-price">{priceLabel(s)}</div>
          {s.description && <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{s.description}</p>}
          {s.lead_hours > 0 && <p className="mr-note" style={{ margin: 0 }}>Request at least {s.lead_hours} hour{s.lead_hours === 1 ? "" : "s"} ahead.</p>}
          <label className="mr-note" style={{ margin: 0 }}>When do you need it?<input type="datetime-local" style={input} value={f.wanted_at} onChange={(e) => setF({ ...f, wanted_at: e.target.value })} /></label>
          {(s.pricing === "per_unit" || s.pricing === "per_hour") && <label className="mr-note" style={{ margin: 0 }}>How many {s.pricing === "per_hour" ? "hours" : s.unit_label ? s.unit_label + "s" : ""}<input type="number" min={s.min_units} style={input} value={f.units} onChange={(e) => setF({ ...f, units: Math.max(s.min_units, Number(e.target.value) || s.min_units) })} /></label>}
          <div className="mr-fld-row">
            <input style={input} placeholder="Slip (e.g. B2)" value={f.slip} onChange={(e) => setF({ ...f, slip: e.target.value })} />
            <input style={input} placeholder="Boat name" value={f.boat} onChange={(e) => setF({ ...f, boat: e.target.value })} />
          </div>
          <textarea style={input} rows={3} placeholder={s.category === "Crew" ? "Trip details: where, how long, how many guests, what kind of crew" : s.category === "Catering" ? "Menu or style, number of guests, dietary needs" : "Tell us exactly what you need"} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
          {!signedIn && (<>
            <input style={input} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <input style={input} type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <input style={input} type="tel" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </>)}
          {subtotal != null ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 15 }}>
              <span>{s.name}{f.units > 1 ? ` × ${f.units}` : ""}</span><span style={{ textAlign: "right" }}>{money(subtotal)}</span>
              {tax > 0 && <><span>Sales tax</span><span style={{ textAlign: "right" }}>{money(tax)}</span></>}
              <b>Total</b><b style={{ textAlign: "right" }}>{money(subtotal + tax)}</b>
              <span className="mr-note" style={{ gridColumn: "1 / -1", margin: 0 }}>{signedIn ? "Charged to your boater account when the office confirms." : "Pay at the office when the office confirms."}</span>
            </div>
          ) : <p className="mr-note" style={{ margin: 0 }}>The office will send you a price. Nothing is charged until you approve it.</p>}
          {err && <div className="mr-error" role="alert">{err}</div>}
          <button className="mr-btn dark" disabled={busy} onClick={send}>{busy ? "Sending…" : isQuote ? "Request a quote" : "Send request"}</button>
        </div>
      </div>
    </div>
  );
}
