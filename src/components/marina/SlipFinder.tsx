"use client";
import { useMemo, useState } from "react";
import type { PublicSlip } from "@/lib/marina/data";
import { rankSlips } from "@/lib/marina/fit";

// Oct 26 (per Mely — "el sistema le dice: este te conviene"): the boater types their boat
// (length, beam, draft, shore power), how long and when. Each slip's limits are the ones the marina
// set in Slips & Rates; the finder keeps only the slips that fit and are free for every night, and
// shows the best fit first (right power, least wasted space). Short stays → "Book now";
// monthly, seasonal or annual → "Request this slip" (the office sends a contract).

type Stay = "transient_daily" | "transient_weekly" | "monthly" | "seasonal" | "annual";
const STAYS: { key: Stay; label: string; unit: string; max: number }[] = [
  { key: "transient_daily", label: "Nights", unit: "night", max: 30 },
  { key: "transient_weekly", label: "Weeks", unit: "week", max: 8 },
  { key: "monthly", label: "Months", unit: "month", max: 11 },
  { key: "seasonal", label: "Season", unit: "month", max: 9 },
  { key: "annual", label: "Year", unit: "year", max: 1 },
];
export type FinderPick = { slip: PublicSlip; mode: "book" | "request"; stay: Stay; units: number; start: string; boat: { name?: string; length: string; beam: string; draft: string; power: string } };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };

export default function SlipFinder({ slips, onPick }: { slips: PublicSlip[]; onPick: (p: FinderPick) => void }) {
  const [open, setOpen] = useState(false);
  const [len, setLen] = useState(""); const [beam, setBeam] = useState(""); const [draft, setDraft] = useState(""); const [power, setPower] = useState("");
  const [stay, setStay] = useState<Stay>("transient_daily");
  const [units, setUnits] = useState(2);
  const [start, setStart] = useState(today());
  const cur = STAYS.find((s) => s.key === stay)!;
  const long = stay === "monthly" || stay === "seasonal" || stay === "annual";
  const endEx = stay === "transient_daily" ? addDays(start, units) : stay === "transient_weekly" ? addDays(start, 7 * units) : addMonths(start, stay === "annual" ? 12 : units);

  const results = useMemo(() => {
    const L = Number(len);
    if (!(L > 0) || !start) return null;
    const free = slips.filter((s) => {
      if (s.status === "maintenance") return false;
      if ((s.kept || s.status === "occupied") && !(s.available_from && s.available_from <= start)) return false;
      if (s.status === "reserved" && !s.booked.length) return false;
      if (s.booked.some(([a, b]) => a < endEx && b > start)) return false;
      if (s.slip_type === "dry" && !long) return false;
      return true;
    });
    return rankSlips(free, { length: L, beam: Number(beam) || null, draft: Number(draft) || null, power: power || null }).slice(0, 3);
  }, [slips, len, beam, draft, power, start, endEx, long]);

  const priceOf = (s: PublicSlip) => {
    const key = stay === "seasonal" || stay === "annual" ? stay : stay;
    const r = (s.rates as any)[key];
    const unit = r ? r.non_resident ?? r.resident : null;
    if (unit == null) return null;
    return { unit, total: stay === "seasonal" || stay === "annual" ? unit : unit * units };
  };

  if (!open) return (
    <button type="button" className="mr-finder-open" onClick={() => setOpen(true)}>
      <b>Find the right slip for my boat</b><span>Tell us your boat and dates — we&apos;ll show the slips that fit, best first.</span>
    </button>
  );

  return (
    <section className="mr-finder" aria-label="Find the right slip">
      <div className="mr-finder-head"><h3>Find the right slip for my boat</h3><button type="button" className="mr-link" onClick={() => setOpen(false)}>Close</button></div>
      <div className="mr-finder-grid">
        <label>Length (ft)*<input inputMode="decimal" value={len} onChange={(e) => setLen(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 34" /></label>
        <label>Beam (ft)<input inputMode="decimal" value={beam} onChange={(e) => setBeam(e.target.value.replace(/[^\d.]/g, ""))} placeholder="width" /></label>
        <label>Draft (ft)<input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))} placeholder="depth" /></label>
        <label>Shore power
          <select value={power} onChange={(e) => setPower(e.target.value)}><option value="">Not needed</option><option value="30A">30 amp</option><option value="50A">50 amp</option><option value="100A">100 amp</option></select>
        </label>
      </div>
      <div className="mr-seg" role="group" aria-label="How long">
        {STAYS.map((s) => <button key={s.key} type="button" aria-pressed={stay === s.key} onClick={() => { setStay(s.key); setUnits(s.key === "seasonal" ? 6 : s.key === "annual" ? 1 : s.key === "monthly" ? 1 : 2); }}>{s.label}</button>)}
      </div>
      <div className="mr-finder-grid two">
        <label>Arriving<input type="date" min={today()} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {stay !== "annual" && <label>How many {cur.unit}s<input type="number" min={1} max={cur.max} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(cur.max, Math.floor(Number(e.target.value)) || 1)))} /></label>}
      </div>

      {results === null ? <p className="mr-note">Enter your boat length to see the slips that fit.</p> : !results.length ? (
        <div className="mr-fit no"><b>No free slip fits those dates.</b> Try other dates, or join the waitlist below and we&apos;ll call you when one opens.</div>
      ) : (
        <ol className="mr-finder-results">
          {results.map((x, i) => {
            const p = priceOf(x.slip);
            const canBook = !long || (stay === "monthly" && p);
            return (
              <li key={x.slip.id} className={i === 0 ? "best" : ""}>
                <div className="top">
                  <div><b>Slip {x.slip.slip_name}</b>{i === 0 && <span className="tag">Best fit</span>}<small>{x.slip.dock ? `${x.slip.dock} · ` : ""}{x.slip.slip_type === "lift" ? "Lift slip" : x.slip.slip_type === "dry" ? "Dry storage" : "Wet slip"}{x.slip.length_ft ? ` · up to ${x.slip.length_ft} ft` : ""}</small></div>
                  {p && <div className="price">{money(p.total)}<small>{stay === "seasonal" ? "season" : stay === "annual" ? "year" : `${units} ${cur.unit}${units > 1 ? "s" : ""}`}</small></div>}
                </div>
                <ul>{x.checks.map((c) => <li key={c.key}>✓ {c.label}: {c.detail}</li>)}</ul>
                <div className="act">
                  {canBook && p && <button type="button" className="mr-btn dark" onClick={() => onPick({ slip: x.slip, mode: "book", stay, units, start, boat: { length: len, beam, draft, power } })}>Book now</button>}
                  {long && <button type="button" className={canBook && p ? "mr-btn" : "mr-btn dark"} onClick={() => onPick({ slip: x.slip, mode: "request", stay, units, start, boat: { length: len, beam, draft, power } })}>Request this slip</button>}
                  {!canBook && !long && !p && <span className="mr-note">Call the office to book this slip.</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mr-note">Each slip&apos;s size limits are set by the marina. Nights and weeks are booked and paid now; monthly, seasonal and annual slips are requested — the office sends you a contract to sign online.</p>
    </section>
  );
}
