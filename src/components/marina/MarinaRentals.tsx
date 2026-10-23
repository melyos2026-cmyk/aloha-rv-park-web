"use client";

import { useEffect, useMemo, useState } from "react";
import type { RentalItem } from "@/lib/rentals";

// Oct 23 (per Mely): the Rentals & Experiences page. Cards by category; booking window with
// date, time (or departure), units/people, waiver signature and payment.
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const to12 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
const priceLine = (i: RentalItem) => {
  if (i.kind === "experience") return i.price_person != null ? `${money(i.price_person)} per person` : "Call for price";
  const p = [i.price_hour != null ? `${money(i.price_hour)}/hr` : null, i.price_day != null ? `${money(i.price_day)}/day` : null, i.price_week != null ? `${money(i.price_week)}/wk` : null].filter(Boolean);
  return p.length ? p.join(" · ") : "Call for price";
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function MarinaRentals({ title, intro, items, taxRate, phone }: { title: string; intro: string; items: RentalItem[]; taxRate: number; phone: string | null }) {
  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category))), [items]);
  const [cat, setCat] = useState("All");
  const [open, setOpen] = useState<RentalItem | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [member, setMember] = useState<any>(null);
  const [done, setDone] = useState<{ booking: string; total: number; charged?: boolean; demo?: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((r) => { setSignedIn(!!r.signedIn); setMember(r.member || null); }).catch(() => {});
    const u = new URLSearchParams(window.location.search);
    if (u.get("booked")) setDone({ booking: u.get("booked")!, total: 0 });
  }, []);
  const shown = items.filter((i) => cat === "All" || i.category === cat);

  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 56px" }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>{title}</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>{intro}</p>
      {cats.length > 1 && (
        <div className="mr-store-chips" role="group" aria-label="Categories">
          {["All", ...cats].map((c) => <button key={c} type="button" className="mr-store-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      )}
      {shown.length === 0 && <p className="mr-note">Nothing to book online yet{phone ? ` — call ${phone}` : ""}.</p>}
      <div className="mr-store-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
        {shown.map((i) => (
          <button key={i.id} type="button" className="mr-store-card" onClick={() => setOpen(i)}>
            <div className="mr-store-img" style={{ aspectRatio: "4 / 3" }}>{i.photo ? <img src={i.photo} alt="" loading="lazy" /> : <span aria-hidden>{i.kind === "experience" ? "⛵" : "🛺"}</span>}</div>
            <div className="mr-store-body">
              <div className="mr-store-cat">{i.category}{i.kind === "experience" && i.duration_minutes ? ` · ${Math.round(i.duration_minutes / 60 * 10) / 10} hr` : ""}</div>
              <div className="mr-store-name">{i.name}</div>
              <div className="mr-store-price">{priceLine(i)}</div>
              {i.deposit > 0 && <div className="mr-store-cat">+ {money(i.deposit)} refundable deposit</div>}
              <span className="mr-store-add" style={{ margin: "10px 0 0" }}>Book</span>
            </div>
          </button>
        ))}
      </div>

      {open && <BookingSheet item={open} taxRate={taxRate} signedIn={signedIn} member={member} onClose={() => setOpen(null)} onDone={(d) => { setOpen(null); setDone(d); }} />}

      {done && (
        <div className="mr-store-modal" onClick={() => setDone(null)}>
          <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()} style={{ padding: 22, textAlign: "center" }}>
            <h3 style={{ marginTop: 0 }}>You're booked!</h3>
            <p style={{ margin: "6px 0" }}>Booking <b>{done.booking}</b>{done.total ? <> · <b>{money(done.total)}</b></> : null}</p>
            <p className="mr-note">{done.charged ? "It was charged to your boater account." : done.demo ? "Demo: no card was charged." : "Your payment was received."} The office has your booking. Bring a photo ID when you arrive.</p>
            <button className="mr-btn dark" onClick={() => setDone(null)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BookingSheet({ item, taxRate, signedIn, member, onClose, onDone }: { item: RentalItem; taxRate: number; signedIn: boolean; member: any; onClose: () => void; onDone: (d: any) => void }) {
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<{ time: string; free: number }[] | null>(null);
  const [closed, setClosed] = useState(false);
  const [pick, setPick] = useState("");
  const [hours, setHours] = useState(item.min_hours);
  const [units, setUnits] = useState(1);
  const [people, setPeople] = useState(2);
  const [f, setF] = useState({ name: member?.full_name || "", email: member?.email || "", phone: member?.phone || "", waiverName: "", notes: "", payment: signedIn ? "account" : "card" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };

  useEffect(() => {
    setSlots(null); setPick("");
    fetch(`/api/marina/rentals?item=${item.id}&date=${date}`, { cache: "no-store" }).then((x) => x.json()).then((r) => { setSlots(r.slots || []); setClosed(!!r.closed); }).catch(() => setSlots([]));
  }, [item.id, date]);

  const isExp = item.kind === "experience";
  const qty = isExp ? people : units;
  let subtotal = 0, basis = "";
  if (isExp) { subtotal = (item.price_person || 0) * people; basis = "per person"; }
  else {
    const opts = [item.price_hour != null ? { b: "hourly", v: item.price_hour * Math.max(hours, item.min_hours) } : null, item.price_day != null ? { b: "daily", v: item.price_day * Math.max(1, Math.ceil(hours / 24)) } : null].filter(Boolean) as { b: string; v: number }[];
    const best = opts.sort((a, b) => a.v - b.v)[0]; subtotal = (best?.v || 0) * units; basis = best?.b || "";
  }
  const tax = item.taxable ? subtotal * taxRate / 100 : 0;
  const deposit = item.deposit * (isExp ? 1 : units);
  const total = subtotal + tax + deposit;
  const freeAtPick = slots?.find((s) => s.time === pick)?.free ?? 0;

  async function book() {
    setBusy(true); setErr("");
    const res = await fetch("/api/marina/rentals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: item.id, date, start: isExp ? undefined : pick, departure: isExp ? pick : undefined, hours, units, people: isExp ? people : undefined, ...f }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setErr(r.error || "Could not book."); return; }
    if (r.url) { window.location.href = r.url; return; }
    setBusy(false); onDone({ booking: r.booking, total: r.total, charged: !!r.charged, demo: !!r.demo });
  }

  return (
    <div className="mr-store-modal" onClick={onClose}>
      <div className="mr-store-sheet" onClick={(e) => e.stopPropagation()}>
        {item.photo && <img src={item.photo} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block", borderRadius: "14px 14px 0 0" }} />}
        <div style={{ padding: 18, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <h3 style={{ margin: 0 }}>{item.name}</h3>
            <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer" }}>×</button>
          </div>
          <div className="mr-store-price">{priceLine(item)}</div>
          {item.description && <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.description}</p>}
          <div className="mr-note" style={{ margin: 0 }}>
            {[item.capacity ? `Up to ${item.capacity} people` : null, item.min_age ? `${item.min_age}+ to book` : null, item.requires_license ? "Driver's license required" : null, item.deposit ? `${money(item.deposit)} refundable deposit` : null].filter(Boolean).join(" · ")}
          </div>

          <label className="mr-note" style={{ margin: 0 }}>Date<input type="date" style={input} min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {!isExp && (
            <label className="mr-note" style={{ margin: 0 }}>How long<select style={input} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[1, 2, 3, 4, 6, 8, 24, 48, 72, 168].filter((h) => h >= item.min_hours).map((h) => <option key={h} value={h}>{h < 24 ? `${h} hour${h > 1 ? "s" : ""}` : h === 168 ? "1 week" : `${h / 24} day${h > 24 ? "s" : ""}`}</option>)}
            </select></label>
          )}
          <div>
            <div className="mr-note" style={{ margin: "0 0 6px" }}>{isExp ? "Departure" : "Start time"}</div>
            {slots === null ? <p className="mr-note">Checking availability…</p> : closed ? <p className="mr-note">Not available on that day.</p> : slots.length === 0 ? <p className="mr-note">No times that day.</p> : (
              <div className="mr-seg">
                {slots.map((s) => <button key={s.time} type="button" disabled={s.free < 1} aria-pressed={pick === s.time} onClick={() => setPick(s.time)} style={{ flex: "0 1 auto", opacity: s.free < 1 ? 0.45 : 1 }}>{/^\d{2}:\d{2}$/.test(s.time) ? to12(s.time) : s.time}{s.free < 1 ? " · full" : s.free <= 2 ? ` · ${s.free} left` : ""}</button>)}
              </div>
            )}
          </div>
          {isExp
            ? <label className="mr-note" style={{ margin: 0 }}>People<input type="number" min={1} max={Math.max(1, freeAtPick || item.quantity)} style={input} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value) || 1))} /></label>
            : item.quantity > 1 && <label className="mr-note" style={{ margin: 0 }}>How many{item.category === "Golf carts" ? " carts" : ""}<input type="number" min={1} max={Math.max(1, freeAtPick || item.quantity)} style={input} value={units} onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} /></label>}

          {!signedIn && (
            <>
              <input style={input} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <input style={input} type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              <input style={input} type="tel" placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </>
          )}
          {item.waiver_text && (
            <div style={{ background: "#eef3f6", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Rental agreement</div>
              <div style={{ fontSize: 13.5, maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{item.waiver_text}</div>
              <input style={{ ...input, marginTop: 8 }} placeholder="Type your full name to sign" value={f.waiverName} onChange={(e) => setF({ ...f, waiverName: e.target.value })} />
            </div>
          )}
          <textarea style={input} rows={2} placeholder="Notes (optional)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", fontSize: 15 }}>
            <span>{qty} × {basis}</span><span style={{ textAlign: "right" }}>{money(subtotal)}</span>
            {tax > 0 && <><span>Sales tax</span><span style={{ textAlign: "right" }}>{money(tax)}</span></>}
            {deposit > 0 && <><span>Refundable deposit</span><span style={{ textAlign: "right" }}>{money(deposit)}</span></>}
            <b>Total</b><b style={{ textAlign: "right" }}>{money(total)}</b>
          </div>
          {signedIn && (
            <div className="mr-seg">
              <button type="button" aria-pressed={f.payment === "account"} onClick={() => setF({ ...f, payment: "account" })}>Charge to my account</button>
              <button type="button" aria-pressed={f.payment === "card"} onClick={() => setF({ ...f, payment: "card" })}>Pay by card now</button>
            </div>
          )}
          {err && <div className="mr-error" role="alert">{err}</div>}
          <button className="mr-btn dark" disabled={busy || !pick} onClick={book}>{busy ? "Booking…" : f.payment === "account" && signedIn ? "Book now" : "Continue to payment"}</button>
        </div>
      </div>
    </div>
  );
}
