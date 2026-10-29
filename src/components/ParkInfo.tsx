"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DAYS, fmtTime, openNowET, telHref, type DayHours, type DayKey, type Emergency, type ParkRuleLite } from "@/lib/portalInfo";

// Oct 28 (per Mely): "Park info" in the resident portal — office hours (Open now / Closed now,
// Eastern Time), the park's emergency phone as tap-to-call, what to do in an emergency in two groups
// (A. call 9-1-1 first — red, top; B. call the park's emergency line), the after-hours fee note
// (separate from both) and the park rules (same rules as the lease application; hidden until the park
// has some). Edited in the admin: Park setup → Resident Portal Info. API: /api/portal/park-info.
// Inline styles on purpose (Tailwind doesn't generate CSS in production on this site).

export type ParkInfoData = {
  parkName: string; configured: boolean;
  hoursMode: "weekly" | "text"; hours: Record<DayKey, DayHours>; hoursText: string; hoursNote: string;
  emergencies: Emergency[]; officePhone: string; emergencyPhone: string; emergencyIsOffice: boolean;
  afterHours: string | null; parkRules: ParkRuleLite[];
};

export async function fetchParkInfo(residentId: string): Promise<ParkInfoData | null> {
  try {
    const res = await fetch(`/api/portal/park-info?residentId=${encodeURIComponent(residentId)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ParkInfoData;
  } catch { return null; }
}

const RED = "#b91c1c";
const RED_BG = "#fef2f2";
const RED_BORDER = "#fca5a5";
const card: CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };
const h2: CSSProperties = { fontWeight: 900, fontSize: 18, margin: 0 };

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const PHONE = "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z";
const CLOCK = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2";
const ALERT = "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01";
const SHIELD = "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z";
const LIST = "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01";
const CHEVRON = "m6 9 6 6 6-6";

function CallButton({ phone, label, tone = "green", compact }: { phone: string; label?: string; tone?: "red" | "green"; compact?: boolean }) {
  if (!phone) return null;
  const red = tone === "red";
  return (
    <a href={telHref(phone)} style={{
      display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", fontWeight: 800, fontSize: compact ? 14 : 15,
      background: red ? RED : "var(--green)", color: "#fff", borderRadius: 8, padding: compact ? "8px 12px" : "10px 16px", whiteSpace: "nowrap",
    }}>
      <Icon d={PHONE} size={compact ? 16 : 18} /> {label || `Call ${phone}`}
    </a>
  );
}

/** Ticks every minute so "Open now" stays right while the page is open. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  return now;
}

function OpenPill({ open }: { open: boolean | null }) {
  if (open === null) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, borderRadius: 999, padding: "3px 10px",
      background: open ? "#dcfce7" : "#f3f4f6", color: open ? "#15803d" : "#4b5563" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: open ? "#16a34a" : "#9ca3af" }} /> {open ? "Open now" : "Closed now"}
    </span>
  );
}

function HoursBlock({ d, now }: { d: ParkInfoData; now: Date }) {
  if (!d.configured) {
    return <p style={{ color: "var(--gray)", fontSize: 14, margin: 0 }}>Call the office for current office hours{d.officePhone ? ` at ${d.officePhone}` : ""}.</p>;
  }
  if (d.hoursMode === "text") {
    return (
      <div>
        <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: 15 }}>{d.hoursText || "Call the office for current office hours."}</p>
        {d.hoursNote && <p style={{ color: "var(--gray)", fontSize: 13, marginTop: 6 }}>{d.hoursNote}</p>}
      </div>
    );
  }
  const todayKey = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now).slice(0, 3).toLowerCase();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontSize: 15 }}>
        {DAYS.map((x) => {
          const h = d.hours[x.key];
          const today = x.key === todayKey;
          return (
            <div key={x.key} style={{ display: "contents" }}>
              <span style={{ fontWeight: today ? 800 : 600 }}>{x.label}{today ? " (today)" : ""}</span>
              <span style={{ fontWeight: today ? 800 : 400, color: h.closed ? "var(--gray)" : undefined }}>{h.closed ? "Closed" : `${fmt(h.open)} – ${fmt(h.close)}`}</span>
            </div>
          );
        })}
      </div>
      <p style={{ color: "var(--gray)", fontSize: 12.5, marginTop: 8 }}>Eastern Time{d.hoursNote ? ` · ${d.hoursNote}` : ""}</p>
    </div>
  );
}
const fmt = fmtTime;

function Situation({ e, phone, red }: { e: Emergency; phone: string; red: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1.5px solid ${red ? RED_BORDER : "var(--border)"}`, borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", background: "none", border: 0, textAlign: "left", cursor: "pointer", font: "inherit", color: red ? RED : "var(--black)", fontWeight: 800, fontSize: 15 }}>
        <span style={{ flex: 1 }}>{e.title}</span>
        <span style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", display: "inline-flex" }}><Icon d={CHEVRON} /></span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px" }}>
          <p style={{ margin: "0 0 12px", fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-line", color: "#1f2937" }}>{e.steps}</p>
          <CallButton phone={phone} label={red ? "Call 911" : `Call ${phone}`} tone={red ? "red" : "green"} compact />
        </div>
      )}
    </div>
  );
}

/** Full "Park info" section. */
export function ParkInfoSection({ data }: { data: ParkInfoData | null }) {
  const now = useNow();
  if (!data) return <div style={card}><p style={{ color: "var(--gray)", fontSize: 14 }}>Park info could not be loaded. Please try again later.</p></div>;
  const open = data.configured ? openNowET({ hours_mode: data.hoursMode, hours: data.hours }, now) : null;
  const nine = data.emergencies.filter((e) => e.group === "911");
  const park = data.emergencies.filter((e) => e.group === "park");
  const ePhone = data.emergencyPhone;
  const Head = ({ icon, title, right, color }: { icon: string; title: string; right?: ReactNode; color?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <span style={{ color: color || "var(--green)", display: "inline-flex" }}><Icon d={icon} size={20} /></span>
      <h2 style={{ ...h2, color: color || undefined, flex: 1 }}>{title}</h2>
      {right}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* A. Call 9-1-1 first */}
      <div id="emergency" className="rp-anchor" style={{ ...card, background: RED_BG, border: `2px solid ${RED}` }}>
        <Head icon={ALERT} title="Call 9-1-1 first" color={RED} right={<CallButton phone="911" label="Call 911" tone="red" />} />
        <p style={{ margin: "0 0 12px", fontSize: 14.5, color: "#7f1d1d" }}>
          For anything life-threatening, call 911 before anything else. Then also notify the park
          {ePhone ? <> at <a href={telHref(ePhone)} style={{ color: RED, fontWeight: 800 }}>{ePhone}</a></> : ""} so staff can meet responders and guide them to your site.
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {nine.map((e) => <Situation key={e.id} e={e} phone="911" red />)}
        </div>
      </div>

      {/* B. Park emergency line */}
      <div id="emergency-line" className="rp-anchor" style={card}>
        <Head icon={SHIELD} title="Call the park's emergency line" right={ePhone ? <CallButton phone={ePhone} /> : undefined} />
        <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--gray)" }}>
          For urgent problems at your site that are not life-threatening.{ePhone && data.emergencyIsOffice ? " This is the office number." : ""}
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {park.map((e) => <Situation key={e.id} e={e} phone={e.phone || ePhone} red={false} />)}
        </div>
      </div>

      {/* Office hours + after-hours note */}
      <div id="office-hours" className="rp-anchor" style={card}>
        <Head icon={CLOCK} title="Office hours" right={<OpenPill open={open} />} />
        <HoursBlock d={data} now={now} />
        {data.officePhone && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>Office: <strong>{data.officePhone}</strong></span>
            <CallButton phone={data.officePhone} label="Call the office" compact />
          </div>
        )}
        {data.afterHours && (
          <div style={{ marginTop: 14, background: "#fffbeb", border: "1.5px solid #fcd34d", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "#78350f" }}>
            <strong>After hours:</strong> {data.afterHours} Real emergencies are covered above.
          </div>
        )}
      </div>

      {/* Park rules — same rules as the lease application; hidden until the park has some */}
      {data.parkRules.length > 0 && (
        <div id="park-rules" className="rp-anchor" style={card}>
          <Head icon={LIST} title="Park rules" />
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, fontSize: 14.5, lineHeight: 1.5 }}>
            {data.parkRules.map((r, i) => (
              <li key={i}>{r.title && <strong>{r.title}{r.text ? ": " : ""}</strong>}{r.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Compact "Emergency & office hours" card for the portal Home. */
export function ParkInfoHomeCard({ data, onOpen }: { data: ParkInfoData | null; onOpen: () => void }) {
  const now = useNow();
  if (!data) return null;
  const open = data.configured ? openNowET({ hours_mode: data.hoursMode, hours: data.hours }, now) : null;
  const todayKey = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now).slice(0, 3).toLowerCase() as DayKey;
  const today = data.configured && data.hoursMode === "weekly" ? data.hours[todayKey] : null;
  return (
    <div style={{ ...card, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <h2 style={{ ...h2, flex: 1 }}>Emergency &amp; office hours</h2>
        <OpenPill open={open} />
      </div>
      <p style={{ margin: "0 0 4px", fontSize: 14 }}>
        {today ? <>Today: <strong>{today.closed ? "Closed" : `${fmt(today.open)} – ${fmt(today.close)}`}</strong></> : data.configured && data.hoursMode === "text" && data.hoursText ? <span style={{ whiteSpace: "pre-line" }}>{data.hoursText}</span> : "Call the office for office hours."}
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 13.5, color: RED, fontWeight: 700 }}>Fire, medical, crime or a strong gas smell: call 911 first.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <CallButton phone="911" label="911" tone="red" compact />
        {data.emergencyPhone && <CallButton phone={data.emergencyPhone} label="Park emergency line" compact />}
        <button type="button" className="rp-link-btn" onClick={onOpen}>What to do &amp; park rules →</button>
      </div>
      {data.afterHours && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--gray)" }}>{data.afterHours}</p>}
    </div>
  );
}
