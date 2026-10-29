"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { usePortalLang } from "@/lib/portalI18n";
import { portalConfirm, portalAlert } from "@/components/portalDialog";
import { REC_HALL_TZ, endOptions, hmLabel, normalizeRecHallRules, parkToday, recHallStatusLabel, startOptions, toMin, type RecHallRules } from "@/lib/recHall";
import { fmtTime } from "@/lib/portalInfo";

// Oct 29 (per Mely): "Request the Rec Hall" in the resident portal (Requests section). Shown only
// while the admin's Rec Hall switch is on and a room is bookable. Free — nothing is charged.
// The day's taken times are shown (times only) so residents can avoid conflicts; the office approves
// or declines in the admin's Rec Hall module, and the resident gets a bell notice + email.
// API: /api/portal/rec-hall. Rules: src/lib/recHall.ts. Inline styles (no Tailwind on this site).

type Req = { id: string; title: string | null; starts_at: string; ends_at: string; status: string; guest_count: number | null; notes: string | null; decline_reason: string | null; canceled_by: string | null };
type Slot = { start: string; end: string; status: string; mine: boolean };
type Data = { enabled: boolean; ready?: boolean; room?: { name: string; capacity: number | null }; rules?: Partial<RecHallRules> & { today: string; lastDay: string }; requests?: Req[]; day?: Slot[] };

const card: CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };
const input: CSSProperties = { width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "9px 10px", fontSize: 14, background: "#fff", boxSizing: "border-box" };
const lbl: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--gray)", marginBottom: 4 };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: REC_HALL_TZ };
const PILL: Record<string, [string, string]> = {
  requested: ["#fef3c7", "#92400e"], booked: ["#dcfce7", "#166534"], declined: ["#fee2e2", "#991b1b"], canceled: ["#f3f4f6", "#4b5563"], done: ["#f3f4f6", "#4b5563"],
};

/** Is the Rec Hall offered to residents (switch on + a bookable room)? For the side menu. */
export async function fetchRecHallOn(residentId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/portal/rec-hall?residentId=${encodeURIComponent(residentId)}`, { cache: "no-store" });
    return res.ok ? !!(await res.json()).enabled : false;
  } catch { return false; }
}

export default function RecHallCard({ residentId, onAvailability }: { residentId: string; onAvailability?: (on: boolean) => void }) {
  const { t, err, date: fmtDate, dateTime } = usePortalLang();
  const [data, setData] = useState<Data | null>(null);
  const [day, setDay] = useState(() => parkToday());
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("16:00");
  const [title, setTitle] = useState("");
  const [guests, setGuests] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/portal/rec-hall?residentId=${encodeURIComponent(residentId)}&date=${encodeURIComponent(d)}`, { cache: "no-store" });
      const j = res.ok ? ((await res.json()) as Data) : { enabled: false };
      setData(j);
      onAvailability?.(!!j.enabled);
    } catch {
      setData({ enabled: false });
      onAvailability?.(false);
    }
  }, [residentId, onAvailability]);
  useEffect(() => { if (residentId) load(day); }, [residentId, day, load]);

  // Oct 29: the company's rules (admin → Rec Hall → Resident request rules); the server checks them again.
  const rules = normalizeRecHallRules(data?.rules);
  const starts = startOptions(rules);
  const startVal = starts.includes(start) ? start : starts.includes("14:00") ? "14:00" : starts[0] || "";
  const ends = endOptions(startVal, rules);
  const endVal = ends.includes(end) ? end : ends[Math.min(3, ends.length - 1)] || "";
  function pickStart(v: string) {
    setStart(v);
    const next = endOptions(v, rules);
    if (!next.includes(end)) setEnd(next[Math.min(3, next.length - 1)] || "");
  }
  const [now] = useState(() => Date.now());

  if (!data || !data.enabled) return null;
  const when = (r: { starts_at: string; ends_at: string }) =>
    `${fmtDate(r.starts_at, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: REC_HALL_TZ })} · ${dateTime(r.starts_at, TIME)} – ${dateTime(r.ends_at, TIME)}`;

  if (data.ready === false) {
    return (
      <div id="rec-hall" className="rp-anchor" style={card}>
        <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("Request the Rec Hall")}</h2>
        <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Rec Hall requests are not available yet.")}</p>
      </div>
    );
  }

  const slots = data.day || [];
  const sMin = toMin(startVal), eMin = toMin(endVal);
  const overlapBooked = slots.some((s) => s.status === "booked" && toMin(s.start) < eMin && (s.end === "24:00" ? 1440 : toMin(s.end)) > sMin);
  const requests = data.requests || [];

  async function send() {
    setMsg(null);
    if (!title.trim()) { setMsg({ text: t("Please enter the event name."), bad: true }); return; }
    const g = Number(guests);
    if (!Number.isInteger(g) || g < 1) { setMsg({ text: t("Please enter how many guests (1 or more)."), bad: true }); return; }
    if (data?.room?.capacity && g > data.room.capacity) { setMsg({ text: t("The Rec Hall fits up to {n} people.", { n: data.room.capacity }), bad: true }); return; }
    setSending(true);
    try {
      const res = await fetch("/api/portal/rec-hall", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, action: "request", date: day, start: startVal, end: endVal, title: title.trim(), guests: g, notes: notes.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ text: j.vars ? t(j.error, j.vars) : err(j.error) || t("Something went wrong. Please try again."), bad: true }); }
      else {
        setTitle(""); setGuests(""); setNotes("");
        setMsg({ text: t("Request sent ✓ The office will review it and let you know."), bad: false });
      }
      await load(day);
    } finally { setSending(false); }
  }

  async function cancel(r: Req) {
    if (!(await portalConfirm(t("Cancel this Rec Hall request?")))) return;
    const res = await fetch("/api/portal/rec-hall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId, action: "cancel", id: r.id }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) await portalAlert(err(j.error) || t("Something went wrong. Please try again."));
    await load(day);
  }

  return (
    <div id="rec-hall" className="rp-anchor" style={{ ...card, marginTop: 16 }}>
      <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("Request the Rec Hall")}</h2>
      <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 14 }}>
        {t("Ask the office to reserve the {room} for your event. Free for residents — the office will approve or decline your request.", { room: data.room?.name || "Rec Hall" })}
        {data.room?.capacity ? ` ${t("Fits up to {n} people.", { n: data.room.capacity })}` : ""}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label><span style={lbl}>{t("Date")}</span>
          <input type="date" style={input} value={day} min={data.rules?.today} max={data.rules?.lastDay} onChange={(e) => setDay(e.target.value)} /></label>
        <label><span style={lbl}>{t("Start time")}</span>
          <select style={input} value={startVal} onChange={(e) => pickStart(e.target.value)}>
            {starts.map((s) => <option key={s} value={s}>{fmtTime(s)}</option>)}
          </select></label>
        <label><span style={lbl}>{t("End time")}</span>
          <select style={input} value={endVal} onChange={(e) => setEnd(e.target.value)}>
            {ends.map((s) => <option key={s} value={s}>{fmtTime(s)}</option>)}
          </select></label>
      </div>

      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>{t("Already taken that day")}</div>
        {slots.length === 0 ? (
          <div style={{ fontSize: 13, color: "#166534" }}>{t("Nothing booked yet — the whole day is open.")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {slots.map((s, i) => (
              <span key={i} style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: s.status === "booked" ? "#fee2e2" : "#fef3c7", color: s.status === "booked" ? "#991b1b" : "#92400e" }}>
                {s.start === "00:00" ? "…" : fmtTime(s.start)} – {s.end === "24:00" ? "…" : fmtTime(s.end)} · {s.mine ? t("Your request") : s.status === "booked" ? t("Booked") : t("Requested (pending)")}
              </span>
            ))}
          </div>
        )}
        {overlapBooked && <div style={{ fontSize: 12.5, color: "#991b1b", fontWeight: 700, marginTop: 6 }}>{t("The Rec Hall is already booked for part of that time. Please choose another time.")}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
        <label><span style={lbl}>{t("Event name")}</span>
          <input style={input} maxLength={120} placeholder={t("Birthday party, family gathering…")} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label><span style={lbl}>{t("Number of guests")}</span>
          <input type="number" inputMode="numeric" min={1} max={data.room?.capacity || 500} style={input} value={guests} onChange={(e) => setGuests(e.target.value)} /></label>
      </div>
      <label style={{ display: "block", marginTop: 10 }}><span style={lbl}>{t("Notes (optional)")}</span>
        <textarea rows={2} maxLength={1000} style={{ ...input, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button type="button" onClick={send} disabled={sending || overlapBooked || !endVal}
          style={{ background: "var(--green)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 800, fontSize: 14, cursor: sending || overlapBooked ? "not-allowed" : "pointer", opacity: sending || overlapBooked ? 0.6 : 1 }}>
          {sending ? t("Sending...") : t("Send request")}
        </button>
        <span style={{ fontSize: 12, color: "var(--gray)" }}>
          {t("Up to {n} days ahead, {from} – {until}, {min} minutes to {max} hours.", { n: rules.maxDaysAhead, from: hmLabel(rules.openFrom), until: hmLabel(rules.openUntil), min: rules.minMinutes, max: rules.maxHours })}
          {rules.minNoticeHours > 0 ? ` ${t("Request at least {n} hours before the start.", { n: rules.minNoticeHours })}` : ""}
        </span>
      </div>
      {rules.note && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 2 }}>{t("Rec Hall rules")}</div>
          {rules.note}
        </div>
      )}
      {msg && <p style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: msg.bad ? "#b91c1c" : "#166534" }}>{msg.text}</p>}

      {requests.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontWeight: 900, fontSize: 15, marginBottom: 8 }}>{t("My Rec Hall requests")}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...requests].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map((r) => {
              const [bg, fg] = PILL[r.status] || PILL.canceled;
              const canCancel = ["requested", "booked"].includes(r.status) && new Date(r.starts_at).getTime() > now;
              return (
                <div key={r.id} style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800 }}>{r.title || t("Event")}</div>
                    <div style={{ fontSize: 13, color: "var(--gray)" }}>{when(r)}{r.guest_count ? ` · ${t("{n} guests", { n: r.guest_count })}` : ""}</div>
                    {r.status === "declined" && r.decline_reason && <div style={{ fontSize: 12.5, color: "#991b1b", marginTop: 4 }}>{t("Reason: {reason}", { reason: r.decline_reason })}</div>}
                    {r.status === "canceled" && r.canceled_by === "office" && <div style={{ fontSize: 12.5, color: "var(--gray)", marginTop: 4 }}>{t("Cancelled by the office.")}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "3px 10px", background: bg, color: fg }}>{t(recHallStatusLabel(r.status))}</span>
                    {canCancel && <button type="button" onClick={() => cancel(r)} style={{ fontSize: 12, color: "var(--gray)", background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("Cancel request")}</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
