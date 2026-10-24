"use client";

import { useEffect, useMemo, useState } from "react";
import { type Restaurant, dayName, pretty, timeSlots } from "@/lib/restaurant-shared";

// Oct 24 (per Mely): Restaurant page — hero, hours, menu (photos / PDF), delivery links
// (Uber Eats, DoorDash, Grubhub…), and "Reserve a table".
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function MarinaRestaurant({ r, marina }: { r: Restaurant; marina: string }) {
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [member, setMember] = useState<any>(null);
  useEffect(() => { fetch("/api/marina/store/order", { cache: "no-store" }).then((x) => x.json()).then((j) => { setSignedIn(!!j.signedIn); setMember(j.member || null); }).catch(() => {}); }, []);
  useEffect(() => {
    if (menuAt == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAt(null); if (e.key === "ArrowRight") setMenuAt((i) => (i == null ? i : Math.min(r.menu_photos.length - 1, i + 1))); if (e.key === "ArrowLeft") setMenuAt((i) => (i == null ? i : Math.max(0, i - 1))); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [menuAt, r.menu_photos.length]);
  const hasMenu = r.menu_photos.length > 0 || !!r.menu_pdf;

  return (
    <div className="mr-rs">
      <section className="mr-rs-hero" style={r.photo ? { backgroundImage: `linear-gradient(180deg, rgba(10,25,45,.35), rgba(10,25,45,.75)), url(${r.photo})` } : undefined}>
        <div className="mr-wrap" style={{ padding: "56px 16px 44px" }}>
          <div className="mr-cr-kicker">Restaurant · {marina}</div>
          <h1 className="mr-h2" style={{ color: "#fff", marginBottom: 6 }}>{r.name}</h1>
          {r.tagline && <p className="mr-lede" style={{ color: "rgba(255,255,255,.9)", marginTop: 0 }}>{r.tagline}</p>}
          <div className="mr-rs-actions">
            {hasMenu && <a className="mr-btn" href="#menu" onClick={(e) => { if (r.menu_photos.length) { e.preventDefault(); setMenuAt(0); } }}>View menu</a>}
            {r.reservations_on && <a className="mr-btn ghost mr-rs-ghost" href="#reserve">Reserve a table</a>}
            {r.delivery.length > 0 && <a className="mr-btn ghost mr-rs-ghost" href="#delivery">Order delivery</a>}
          </div>
        </div>
      </section>

      <div className="mr-wrap" style={{ padding: "28px 16px 64px" }}>
        <div className="mr-rs-grid">
          <div className="mr-rs-main">
            {r.description && <p className="mr-rs-desc">{r.description}</p>}
            {(r.hours_text || r.phone) && (
              <div className="mr-rs-info">
                {r.hours_text && <div><b>Hours</b><div>{r.hours_text}</div></div>}
                {r.phone && <div><b>Phone</b><div><a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a></div></div>}
              </div>
            )}

            {hasMenu && (
              <section id="menu" className="mr-rs-block">
                <h2 className="mr-h3">Menu</h2>
                {r.menu_photos.length > 0 && (
                  <div className="mr-rs-menu">
                    {r.menu_photos.map((p, i) => <button key={p} type="button" className="mr-rs-menu-page" onClick={() => setMenuAt(i)} aria-label={`Open menu page ${i + 1}`}><img src={p} alt={`Menu page ${i + 1}`} loading="lazy" /><span>Page {i + 1}</span></button>)}
                  </div>
                )}
                {r.menu_pdf && <a className="mr-btn ghost" href={r.menu_pdf} target="_blank" rel="noopener" style={{ marginTop: 12 }}>Open menu (PDF)</a>}
              </section>
            )}

            {r.delivery.length > 0 && (
              <section id="delivery" className="mr-rs-block">
                <h2 className="mr-h3">Delivery &amp; pickup</h2>
                <p className="mr-note" style={{ marginTop: 0 }}>Order from {r.name} through our delivery partners. You'll be taken to their site to complete the order.</p>
                <div className="mr-rs-delivery">
                  {r.delivery.map((d) => <a key={d.url} className={`mr-rs-dl mr-rs-dl-${d.brand}`} href={d.url} target="_blank" rel="noopener">Order on <b>{d.label}</b> ↗</a>)}
                </div>
              </section>
            )}
          </div>

          <aside className="mr-rs-side" id="reserve">
            {r.reservations_on ? <ReserveCard r={r} signedIn={signedIn} member={member} /> : (
              <div className="mr-card"><h3 style={{ marginTop: 0 }}>Reservations</h3><p className="mr-note" style={{ margin: 0 }}>Please call {r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : "the restaurant"} to reserve a table.</p></div>
            )}
          </aside>
        </div>
      </div>

      {menuAt != null && r.menu_photos[menuAt] && (
        <div className="mr-rs-light" onClick={() => setMenuAt(null)} role="dialog" aria-label="Menu">
          <button type="button" className="mr-rs-x" aria-label="Close" onClick={() => setMenuAt(null)}>×</button>
          {r.menu_photos.length > 1 && <button type="button" className="mr-rs-arrow mr-rs-prev" aria-label="Previous page" disabled={menuAt === 0} onClick={(e) => { e.stopPropagation(); setMenuAt(Math.max(0, menuAt - 1)); }}>‹</button>}
          <img src={r.menu_photos[menuAt]} alt={`Menu page ${menuAt + 1}`} onClick={(e) => e.stopPropagation()} />
          {r.menu_photos.length > 1 && <button type="button" className="mr-rs-arrow mr-rs-next" aria-label="Next page" disabled={menuAt === r.menu_photos.length - 1} onClick={(e) => { e.stopPropagation(); setMenuAt(Math.min(r.menu_photos.length - 1, menuAt + 1)); }}>›</button>}
          {r.menu_photos.length > 1 && <div className="mr-rs-count">{menuAt + 1} / {r.menu_photos.length}</div>}
        </div>
      )}
    </div>
  );
}

function ReserveCard({ r, signedIn, member }: { r: Restaurant; signedIn: boolean; member: any }) {
  const [f, setF] = useState({ date: todayIso(), time: "", party: 2, name: "", phone: "", email: "", notes: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [done, setDone] = useState<{ number: string; status: string; when: string } | null>(null);
  const slots = useMemo(() => timeSlots(r), [r]);
  const closed = r.closed_days.includes(dayName(new Date(f.date + "T12:00:00")));
  const input = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };
  useEffect(() => { if (member) setF((x) => ({ ...x, name: x.name || member.full_name || "", email: x.email || member.email || "", phone: x.phone || member.phone || "" })); }, [member]);

  async function send() {
    setBusy(true); setErr("");
    const res = await fetch("/api/marina/restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(j.error || "Could not reserve."); return; }
    setDone({ number: j.number, status: j.status, when: j.when });
  }
  if (done) return (
    <div className="mr-card" style={{ textAlign: "center" }}>
      <div className="mr-cr-check" aria-hidden>✓</div>
      <h3 style={{ marginBottom: 4 }}>{done.status === "confirmed" ? "Table reserved" : "Request received"}</h3>
      <p style={{ margin: "4px 0" }}><b>{done.when}</b> · party of {f.party}</p>
      <p className="mr-note">{done.status === "confirmed" ? `You're all set. Reservation ${done.number}.` : `The restaurant will confirm shortly by ${f.phone ? "phone or " : ""}email. Reservation ${done.number}.`}{signedIn ? " You'll also see it in your account." : ""}</p>
      <button className="mr-btn ghost" onClick={() => setDone(null)}>Make another</button>
    </div>
  );
  return (
    <div className="mr-card">
      <h3 style={{ marginTop: 0 }}>Reserve a table</h3>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="mr-fld-row">
          <label className="mr-fld"><span>Date</span><input style={input} type="date" min={todayIso()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, time: "" })} /></label>
          <label className="mr-fld"><span>Party size</span><select style={input} value={f.party} onChange={(e) => setF({ ...f, party: Number(e.target.value) })}>{Array.from({ length: r.max_party }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "person" : "people"}</option>)}</select></label>
        </div>
        {closed ? <p className="mr-note" style={{ margin: 0 }}>We're closed on {dayName(new Date(f.date + "T12:00:00"))}s — pick another day.</p> : (
          <div className="mr-fld"><span>Time</span><div className="mr-chips">{slots.map((t) => <button key={t} type="button" aria-pressed={f.time === t} onClick={() => setF({ ...f, time: t })}>{pretty(t)}</button>)}</div></div>
        )}
        {!signedIn && (<>
          <label className="mr-fld"><span>Name</span><input style={input} placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <div className="mr-fld-row">
            <label className="mr-fld"><span>Phone</span><input style={input} type="tel" placeholder="(555) 555-5555" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="mr-fld"><span>Email</span><input style={input} type="email" placeholder="you@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          </div>
        </>)}
        <label className="mr-fld"><span>Notes <em>optional</em></span><input style={input} placeholder="Birthday, high chair, outdoor table…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <p className="mr-note" style={{ margin: 0 }}>Parties over {r.max_party}? Call {r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : "us"}.{r.auto_confirm ? "" : " We'll confirm your request shortly."}</p>
        {err && <div className="mr-error" role="alert">{err}</div>}
        <button className="mr-btn dark" disabled={busy || closed || !f.time} onClick={send}>{busy ? "Sending…" : r.auto_confirm ? "Reserve" : "Request a table"}</button>
      </div>
    </div>
  );
}
