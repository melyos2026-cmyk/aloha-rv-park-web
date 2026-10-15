"use client";
import { useMemo, useState } from "react";
import type { PublicSlip, SlipType } from "@/lib/marina/data";
import { RATE_LABEL, RATE_TYPES } from "@/lib/marina/rates";

const money = (n: number | null) => (n === null ? "" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const TYPES: { key: SlipType; title: string; blurb: string }[] = [
  { key: "wet", title: "Wet slips", blurb: "Your boat stays in the water, ready to go in minutes." },
  { key: "lift", title: "Lift slips", blurb: "Lifted out of the water between trips: safer and cleaner." },
  { key: "dry", title: "Dry storage", blurb: "Long-term storage, and a dry place for repairs." },
];
const STATUS_TEXT = { available: "Open", occupied: "Taken", reserved: "Reserved", maintenance: "Closed for repair" } as const;


export default function SlipBoard({ slips }: { slips: PublicSlip[] }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [power, setPower] = useState(false);
  const [boat, setBoat] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [type, setType] = useState<SlipType | "all">("all");
  const hasMap = slips.some((s) => s.map);
  const [view, setView] = useState<"map" | "list">(hasMap ? "map" : "list");
  // Dry storage is on land, so it is never drawn on the water map.
  const showMap = view === "map" && hasMap && type !== "dry";

  const boatLen = Number(boat) || 0;
  const shown = useMemo(() => slips.filter((s) => type === "all" || s.slip_type === type), [slips, type]);
  const docks = useMemo(() => {
    const m = new Map<string, PublicSlip[]>();
    for (const s of shown) {
      const k = s.dock || "Main dock";
      m.set(k, [...(m.get(k) || []), s]);
    }
    return [...m.entries()];
  }, [shown]);

  const fits = (s: PublicSlip) =>
    s.status === "available" && (!boatLen || (s.length_ft ?? 0) >= boatLen) && (!power || s.has_power);
  const dim = (s: PublicSlip) => (openOnly || boatLen > 0 || power) && !fits(s);
  const selected = slips.find((s) => s.id === picked) || null;

  function reserve(s: PublicSlip) {
    window.dispatchEvent(new CustomEvent("mr-pick-slip", { detail: { slip: s.slip_name, length: s.length_ft } }));
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  }

  if (!slips.length) return <p className="mr-note">Slip availability is being updated. Call the office for current openings.</p>;

  const present = TYPES.filter((t) => slips.some((s) => s.slip_type === t.key));

  return (
    <div>
      {present.length > 1 && (
        <div className="mr-types" role="group" aria-label="Choose a type">
          {present.map((t) => {
            const all = slips.filter((s) => s.slip_type === t.key);
            const open = all.filter((s) => s.status === "available").length;
            return (
              <button key={t.key} type="button" className="mr-type" aria-pressed={type === t.key} onClick={() => { setType(type === t.key ? "all" : t.key); setPicked(null); }}>
                <b>{t.title}</b>
                <span>{t.blurb}</span>
                <em>{open} open of {all.length}</em>
              </button>
            );
          })}
        </div>
      )}
      <div className="mr-tools">
        <label>
          My boat length (ft)
          <input type="number" min="0" inputMode="decimal" value={boat} onChange={(e) => setBoat(e.target.value)} placeholder="e.g. 32" />
        </label>
        <button type="button" className="mr-chip" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>Open slips only</button>
        <button type="button" className="mr-chip" aria-pressed={power} onClick={() => setPower(!power)}>Shore power</button>
      </div>
      <div className="mr-legend" aria-hidden="true">
        <span><i style={{ width: 16, height: 10, border: "2px dashed var(--mr-open)", borderRadius: 3 }} /> Open</span>
        <span><i style={{ width: 16, height: 10, border: "2px solid #d64550", background: "#fbe3e5", borderRadius: 3 }} /> Taken</span>
        <span><i style={{ width: 16, height: 10, border: "2px solid var(--mr-buoy)", background: "#fff3d6", borderRadius: 3 }} /> Reserved</span>
      </div>
      {hasMap && (
        <div className="mr-views" role="group" aria-label="View">
          <button type="button" className="mr-chip" aria-pressed={view === "map"} onClick={() => setView("map")}>Marina map</button>
          <button type="button" className="mr-chip" aria-pressed={view === "list"} onClick={() => setView("list")}>By dock</button>
        </div>
      )}

      {showMap && (
        <div className="mr-map" onClick={() => setPicked(null)}>
          <img src="/marina/map.jpg" alt="Aerial view of the marina docks" />
          {slips.filter((s) => s.map && (type === "all" || s.slip_type === type)).map((s) => (
            <button
              key={s.id}
              type="button"
              className="mr-hot"
              data-status={s.status}
              data-dim={dim(s)}
              aria-pressed={picked === s.id}
              aria-label={`Slip ${s.slip_name}, ${STATUS_TEXT[s.status]}${s.length_ft ? `, ${s.length_ft} feet` : ""}`}
              style={{ left: `${s.map!.x}%`, top: `${s.map!.y}%`, width: `${s.map!.w}%`, height: `${s.map!.h}%` }}
              onClick={(e) => { e.stopPropagation(); setPicked(s.id); }}
            >
              <span>{s.slip_name}</span>
            </button>
          ))}
          {selected && selected.map && (
            <div
              className="mr-pop"
              style={{
                top: `${Math.min(selected.map.y, 68)}%`,
                ...(selected.map.x > 50 ? { right: `${100 - selected.map.x + 1}%` } : { left: `${selected.map.x + selected.map.w + 1}%` }),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mr-pop-head">
                <b>{selected.slip_name}</b>
                <span className={`mr-status ${selected.status}`}>{STATUS_TEXT[selected.status]}</span>
              </div>
              <div className="mr-pop-sub">{selected.slip_type === "dry" ? "Dry storage" : selected.slip_type === "lift" ? "Lift slip" : "Wet slip"}{selected.dock ? ` · ${selected.dock}` : ""}</div>
              <div className="mr-pop-rows">
                {selected.length_ft && <span>Length <b>{selected.length_ft} ft</b></span>}
                {selected.max_beam_ft && <span>Beam <b>{Math.round(selected.max_beam_ft * 10) / 10} ft</b></span>}
                {selected.max_draft_ft && <span>Draft <b>{selected.max_draft_ft} ft</b></span>}
                <span>Power <b>{selected.has_power ? "Yes" : "No"}</b></span>
                <span>Water <b>{selected.has_water ? "Yes" : "No"}</b></span>
                {selected.rates.monthly && <span>Monthly <b>{money(selected.rates.monthly.non_resident ?? selected.rates.monthly.resident)}</b></span>}
              </div>
              {selected.status !== "maintenance" && (
                <button type="button" className="mr-btn dark" onClick={() => reserve(selected)}>
                  {selected.status === "available" ? "Request this slip" : "Join the waitlist"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mr-water" hidden={showMap}>
        {docks.map(([dock, list]) => (
          <div key={dock}>
            <div className="mr-dock-label">{dock}</div>
            <div className="mr-pier">
              <div className="mr-row">
                {list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="mr-slip"
                    data-status={s.status}
                    data-dim={dim(s)}
                    aria-pressed={picked === s.id}
                    aria-label={`Slip ${s.slip_name}, ${STATUS_TEXT[s.status]}${s.length_ft ? `, ${s.length_ft} feet` : ""}`}
                    onClick={() => setPicked(s.id)}
                  >
                    <span className="nm">{s.slip_name}</span>
                    <span className="sz">{s.length_ft ? `${s.length_ft}′` : "—"}{s.max_beam_ft ? ` × ${Math.round(s.max_beam_ft * 10) / 10}′` : ""}</span>
                    <span className="ic">
                      {s.has_power && <svg width="12" height="12" viewBox="0 0 12 12" aria-label="Power"><path d="M7 0 2 7h3l-1 5 6-7H7z" fill="currentColor" /></svg>}
                      {s.has_water && <svg width="12" height="12" viewBox="0 0 12 12" aria-label="Water"><path d="M6 0C4 3 2 5 2 7.5a4 4 0 0 0 8 0C10 5 8 3 6 0z" fill="currentColor" /></svg>}
                    </span>
                    <span className="st">{STATUS_TEXT[s.status]}</span>
                  </button>
                ))}
              </div>
              <div className="mr-planks" />
            </div>
          </div>
        ))}
      </div>

      {selected && !showMap && (
        <div className="mr-detail" aria-live="polite">
          <div>
            <h3>{selected.slip_type === "dry" ? "Storage space" : selected.slip_type === "lift" ? "Lift slip" : "Wet slip"} {selected.slip_name}</h3>
            <span className={`mr-status ${selected.status}`}>{STATUS_TEXT[selected.status]}</span>
          </div>
          <div className="mr-facts">
            {selected.length_ft && <span>Length <b>{selected.length_ft} ft</b></span>}
            {selected.max_beam_ft && <span>Max beam <b>{selected.max_beam_ft} ft</b></span>}
            {selected.max_draft_ft && <span>Max draft <b>{selected.max_draft_ft} ft</b></span>}
            <span>Power <b>{selected.has_power ? "Yes" : "No"}</b></span>
            <span>Water <b>{selected.has_water ? "Yes" : "No"}</b></span>
          </div>
          <div className="mr-facts">
            {RATE_TYPES.filter((t) => selected.rates[t]).map((t) => (
              <span key={t}>{RATE_LABEL[t]} <b>{money(selected.rates[t]!.non_resident ?? selected.rates[t]!.resident)}</b></span>
            ))}
          </div>
          {selected.status === "maintenance" ? (
            <p className="mr-note">This slip is closed for repair.</p>
          ) : (
            <div>
              <button type="button" className="mr-btn dark" onClick={() => reserve(selected)}>
                {selected.status === "available" ? "Request this slip" : "Join the waitlist for this size"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
