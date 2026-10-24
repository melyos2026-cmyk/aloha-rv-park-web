"use client";
import { useMemo, useState } from "react";
import type { PublicSlip, SlipType } from "@/lib/marina/data";
import { RATE_LABEL, RATE_TYPES } from "@/lib/marina/rates";
import ReserveModal from "./ReserveModal";

// Whole dollars show as $280; anything with cents always shows two decimals ($2,553.60).
const money = (n: number | null | undefined) => (n == null ? "" : `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`);
const TYPES: { key: SlipType; title: string; blurb: string }[] = [
  { key: "wet", title: "Wet slips", blurb: "Your boat stays in the water, ready to go in minutes." },
  { key: "lift", title: "Lift slips", blurb: "Lifted out of the water between trips: safer and cleaner." },
  { key: "dry", title: "Dry storage", blurb: "Long-term storage, and a dry place for repairs." },
];
const centroid = (pts: [number, number][]): [number, number] => [
  pts.reduce((a, p) => a + p[0], 0) / pts.length,
  pts.reduce((a, p) => a + p[1], 0) / pts.length,
];
const fmt = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const todayLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const STATUS_TEXT = { available: "Open", occupied: "Taken", reserved: "Reserved", maintenance: "Closed for repair" } as const;


export default function SlipBoard({ slips }: { slips: PublicSlip[] }) {
  const [openOnly, setOpenOnly] = useState(false);
  const [power, setPower] = useState(false);
  const [boat, setBoat] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  // Oct 24 (per Mely): on a computer, resting the mouse on a slip shows a small preview card.
  const [hover, setHover] = useState<string | null>(null);
  const [booking, setBooking] = useState<PublicSlip | null>(null);
  const [onDate, setOnDate] = useState("");
  const [type, setType] = useState<SlipType | "all">("all");
  const hasMap = slips.some((s) => s.map);
  const [view, setView] = useState<"map" | "list">(hasMap ? "map" : "list");
  // Dry storage is on land, so it is never drawn on the water map.
  const showMap = view === "map" && hasMap && type !== "dry";

  const boatLen = Number(boat) || 0;
  const shown = useMemo(() => slips.filter((s) => type === "all" || s.slip_type === type), [slips, type]);

  // A slip is open on a day if it is free now, or its contract ends by then, and nobody booked that day.
  const openOn = (s: PublicSlip, d: string) =>
    (s.status === "available" || (s.status === "occupied" && !!s.available_from && s.available_from <= d)) &&
    !s.booked.some(([a, b]) => a <= d && d < b);
  // What the visitor sees: with a date picked, status answers "is it open that day?"
  const eff = (s: PublicSlip): PublicSlip["status"] =>
    !onDate || s.status === "maintenance" ? s.status : openOn(s, onDate) ? "available" : s.status === "available" ? "reserved" : s.status === "reserved" ? "reserved" : "occupied";
  const fits = (s: PublicSlip) =>
    eff(s) === "available" && (!boatLen || (s.length_ft ?? 0) >= boatLen) && (!power || s.has_power);
  const dim = (s: PublicSlip) => (openOnly || boatLen > 0 || power || !!onDate) && !fits(s);
  const selected = slips.find((s) => s.id === picked) || null;

  function reserve(s: PublicSlip) {
    window.dispatchEvent(new CustomEvent("mr-pick-slip", { detail: { slip: s.slip_name, length: s.length_ft } }));
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
  }


  const canBook = (s: PublicSlip) => s.status === "available" || (s.status === "occupied" && !!s.available_from);
  const when = (s: PublicSlip) => (
    <>
      {s.status === "occupied" && s.available_from && (
        <div className="mr-opens">{s.available_from <= todayLocal() ? "Contract ended: opening soon" : <>Opens <b>{fmt(s.available_from)}</b></>}</div>
      )}
      {s.booked.length > 0 && (
        <div className="mr-opens held">Booked: {s.booked.slice(0, 3).map(([a, b]) => `${fmt(a)} to ${fmt(b)}`).join("; ")}</div>
      )}
    </>
  );

  if (!slips.length) return <p className="mr-note">Slip availability is being updated. Call the office for current openings.</p>;

  // Oct 22 (per Mely): tapping Wet / Lift / Dry also takes you down to the slips, so on a
  // phone you see right away that the map changed (before, the tap looked like it did nothing).
  const jumpToMap = () => setTimeout(() => {
    const el = document.getElementById("mr-showing");
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6 || top < 0) window.scrollTo({ top: window.scrollY + top - 90, behavior: "smooth" });
  }, 60);
  const present = TYPES.filter((t) => slips.some((s) => s.slip_type === t.key));

  return (
    <div>
      {present.length > 1 && (
        <div className="mr-types" role="group" aria-label="Choose a type">
          {present.map((t) => {
            const all = slips.filter((s) => s.slip_type === t.key);
            const open = all.filter((s) => eff(s) === "available").length;
            return (
              <button key={t.key} type="button" className="mr-type" aria-pressed={type === t.key} onClick={() => { const next = type === t.key ? "all" : t.key; setType(next); setPicked(null); if (next !== "all") jumpToMap(); }}>
                <b>{t.title}</b>
                <span>{t.blurb}</span>
                <em>{open} open of {all.length}</em>
              </button>
            );
          })}
        </div>
      )}
      {type !== "all" && (
        <p className="mr-showing" id="mr-showing">
          Showing {TYPES.find((x) => x.key === type)?.title.toLowerCase()} only.{" "}
          <button type="button" onClick={() => setType("all")}>Show all</button>
        </p>
      )}
      <div className="mr-tools">
        <label>
          My boat length (ft)
          <input type="number" min="0" inputMode="decimal" value={boat} onChange={(e) => setBoat(e.target.value)} placeholder="e.g. 32" />
        </label>
        <label>
          Arriving on
          <input type="date" min={todayLocal()} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </label>
        {onDate && <button type="button" className="mr-chip" onClick={() => setOnDate("")}>Clear date</button>}
        <button type="button" className="mr-chip" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>Open slips only</button>
        <button type="button" className="mr-chip" aria-pressed={power} onClick={() => setPower(!power)}>Shore power</button>
      </div>
      <div className="mr-legend" role="list" aria-label="Map colors">
        <span role="listitem"><i className="lg open" /> Open: you can reserve it</span>
        <span role="listitem"><i className="lg taken" /> Taken: tap it to see when it opens</span>
        <span role="listitem"><i className="lg held" /> Reserved: booked for upcoming dates</span>
        <span role="listitem"><i className="lg closed" /> Closed for repair</span>
      </div>
      {hasMap && (
        <div className="mr-views" role="group" aria-label="View">
          <button type="button" className="mr-chip" aria-pressed={view === "map"} onClick={() => setView("map")}>Marina map</button>
          <button type="button" className="mr-chip" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
        </div>
      )}

      {showMap && (
        <div className="mr-map" onClick={() => setPicked(null)}>
          <img src="/marina/map.jpg" alt="Aerial view of the marina docks" />
          <svg className="mr-polys" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Slips on the marina map">
            {slips.filter((s) => s.map && (type === "all" || s.slip_type === type)).map((s) => (
              <polygon
                key={s.id}
                className="mr-poly"
                data-status={eff(s)}
                data-dim={dim(s)}
                data-picked={picked === s.id}
                points={s.map!.points.map((p) => p.join(",")).join(" ")}
                role="button"
                tabIndex={0}
                aria-label={`Slip ${s.slip_name}, ${STATUS_TEXT[eff(s)]}${s.length_ft ? `, ${s.length_ft} feet` : ""}`}
                aria-pressed={picked === s.id}
                onClick={(e) => { e.stopPropagation(); setPicked(s.id); setHover(null); }}
                onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(s.id); }}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover((h) => (h === s.id ? null : h)); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(s.id); } }}
              />
            ))}
          </svg>
          {slips.filter((s) => s.map && (type === "all" || s.slip_type === type)).map((s) => {
            const c = centroid(s.map!.points);
            return <span key={s.id} className="mr-polylabel" data-dim={dim(s)} style={{ left: `${c[0]}%`, top: `${c[1]}%` }}>{s.slip_name}</span>;
          })}
          {(() => {
            const h = hover && hover !== picked ? slips.find((x) => x.id === hover) : null;
            if (!h || !h.map) return null;
            const xs = h.map.points.map((p) => p[0]), ys = h.map.points.map((p) => p[1]);
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            const v = minY > 40 ? { bottom: `${Math.max(100 - minY + 1, 2)}%` } : { top: `${Math.min(maxY + 1, 90)}%` };
            const hz = minX > 50 ? { right: `${Math.max(100 - maxX, 1)}%` } : { left: `${Math.max(minX, 1)}%` };
            const r = h.rates?.monthly; const m = r ? (r.non_resident ?? r.resident) : null;
            const night = h.rates?.transient_daily; const n = night ? (night.non_resident ?? night.resident) : null;
            return (
              <div className="mr-hover" style={{ ...v, ...hz }} aria-hidden>
                {h.photo && <img src={h.photo} alt="" />}
                <div className="mr-hover-body">
                  <div className="mr-pop-head"><b>{h.slip_name}</b><span className={`mr-status ${eff(h)}`}>{STATUS_TEXT[eff(h)]}</span></div>
                  <div className="mr-pop-sub">{[h.length_ft ? `Up to ${h.length_ft} ft` : null, h.has_power ? (h.power_amps ? h.power_amps.replace(/A/g, " amp") : "Power") : null, h.has_water ? "Water" : null].filter(Boolean).join(" · ")}</div>
                  {(m != null || n != null) && <div className="mr-hover-price">{m != null ? <><b>{usd(m)}</b>/mo</> : null}{m != null && n != null ? " · " : ""}{n != null ? <><b>{usd(n)}</b>/night</> : null}</div>}
                  <div className="mr-hover-cta">{canBook(h) ? "Click to reserve" : "Click for details"}</div>
                </div>
              </div>
            );
          })()}
          {selected && selected.map && (
            <div
              className="mr-pop"
              style={(() => {
                const xs = selected.map.points.map((p) => p[0]), ys = selected.map.points.map((p) => p[1]);
                const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                // Lower half of the map: grow upward so the card is never cut off.
                const vertical = minY > 40 ? { bottom: `${Math.max(100 - maxY, 2)}%` } : { top: `${Math.max(minY, 2)}%` };
                return { ...vertical, ...(minX > 50 ? { right: `${100 - minX + 1}%` } : { left: `${maxX + 1}%` }) };
              })()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Oct 22 (per Mely): close the card and pick another slip. */}
              <button type="button" className="mr-pop-x" aria-label="Close" onClick={() => setPicked(null)}>×</button>
              {selected.photo && <img className="mr-pop-photo" src={selected.photo} alt={`Slip ${selected.slip_name}`} />}
              <div className="mr-pop-head">
                <b>{selected.slip_name}</b>
                <span className={`mr-status ${eff(selected)}`}>{STATUS_TEXT[eff(selected)]}</span>
              </div>
              <div className="mr-pop-sub">{selected.slip_type === "dry" ? "Dry storage" : selected.slip_type === "lift" ? "Lift slip" : "Wet slip"}{selected.dock ? ` · ${selected.dock}` : ""}</div>
              {when(selected)}
              <SlipFacts s={selected} />
              {selected.status !== "maintenance" && (
                canBook(selected) ? (
                  <>
                    <button type="button" className="mr-btn dark" onClick={() => setBooking(selected)}>{selected.status === "occupied" ? `Reserve from ${fmt(selected.available_from!)}` : "Reserve online"}</button>
                    <button type="button" className="mr-btn link" onClick={() => reserve(selected)}>Ask the office</button>
                  </>
                ) : (
                  <button type="button" className="mr-btn dark" onClick={() => reserve(selected)}>Join the waitlist</button>
                )
              )}
            </div>
          )}
        </div>
      )}

      {selected && !showMap && (
        <div className="mr-detail" aria-live="polite" style={{ position: "relative" }}>
          <button type="button" className="mr-pop-x" aria-label="Close" onClick={() => setPicked(null)}>×</button>
          {selected.photo && <img className="mr-pop-photo" src={selected.photo} alt={`Slip ${selected.slip_name}`} />}
          <div>
            <h3>{selected.slip_type === "dry" ? "Storage space" : selected.slip_type === "lift" ? "Lift slip" : "Wet slip"} {selected.slip_name}</h3>
            <span className={`mr-status ${eff(selected)}`}>{STATUS_TEXT[eff(selected)]}</span>
          </div>
          {when(selected)}
          <div className="mr-facts">
            {selected.length_ft && <span>Length <b>{selected.length_ft} ft</b></span>}
            {selected.max_beam_ft && <span>Max beam <b>{selected.max_beam_ft} ft</b></span>}
            {selected.max_draft_ft && <span>Max draft <b>{selected.max_draft_ft} ft</b></span>}
          </div>
          <SlipFacts s={selected} />
          <div className="mr-facts">
            {RATE_TYPES.filter((t) => selected.rates[t]).map((t) => (
              <span key={t}>{RATE_LABEL[t]} <b>{money(selected.rates[t]!.non_resident ?? selected.rates[t]!.resident)}</b></span>
            ))}
          </div>
          {selected.status === "maintenance" ? (
            <p className="mr-note">This slip is closed for repair.</p>
          ) : (
            <div>
              {canBook(selected) ? (
                <>
                  <button type="button" className="mr-btn dark" onClick={() => setBooking(selected)}>{selected.status === "occupied" ? `Reserve from ${fmt(selected.available_from!)}` : "Reserve online"}</button>
                  <button type="button" className="mr-btn link" onClick={() => reserve(selected)}>Ask the office</button>
                </>
              ) : (
                <button type="button" className="mr-btn dark" onClick={() => reserve(selected)}>Join the waitlist for this size</button>
              )}
            </div>
          )}
        </div>
      )}
      {!showMap && (
        <div className="mr-listwrap">
          <table className="mr-table mr-slips-table">
            <thead>
              <tr><th>Slip</th><th>Type</th><th>Size</th><th>Utilities</th><th>Monthly</th><th>Status</th><th><span className="sr-only">Details</span></th></tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const st = eff(s);
                const m = s.rates.monthly ? s.rates.monthly.non_resident ?? s.rates.monthly.resident : null;
                return (
                  <tr key={s.id} data-dim={dim(s)} data-picked={picked === s.id}>
                    <td className="num">{s.slip_name}{s.dock ? <small>{s.dock}</small> : null}</td>
                    <td>{s.slip_type === "dry" ? "Dry storage" : s.slip_type === "lift" ? "Lift slip" : "Wet slip"}</td>
                    <td className="num">{s.length_ft ? `${s.length_ft}′` : "—"}{s.max_beam_ft ? ` × ${Math.round(s.max_beam_ft * 10) / 10}′` : ""}</td>
                    <td>{[s.has_power && "Power", s.has_water && "Water"].filter(Boolean).join(", ") || "—"}</td>
                    <td className="num">{m ? money(m) : "—"}</td>
                    <td><span className={`mr-status ${st}`}>{STATUS_TEXT[st]}</span>{s.status === "occupied" && s.available_from && st !== "available" ? <small>Opens {fmt(s.available_from)}</small> : null}</td>
                    <td><button type="button" className="mr-btn link" onClick={() => setPicked(s.id)} aria-label={`Details for slip ${s.slip_name}`}>Details</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {booking && <ReserveModal slip={booking} startDate={onDate || undefined} onClose={() => setBooking(null)} />}
    </div>
  );
}


// Oct 22 (per Mely): what a boater needs before renting — what fits, power and water,
// the prices for each stay, and the slip's extras. Prices come from Slips & Rates.
// $588 for whole dollars, $94.50 with cents.
const usd = (v: number | string) => { const x = Number(v); return `$${x.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 })}`; };

function SlipFacts({ s }: { s: PublicSlip }) {
  const price = (t: "monthly" | "transient_weekly" | "transient_daily") => {
    const r = s.rates[t]; const v = r ? (r.non_resident ?? r.resident) : null;
    return v == null ? null : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`;
  };
  const fits = [s.length_ft ? `${s.length_ft} ft long` : null, s.max_beam_ft ? `${Math.round(s.max_beam_ft * 10) / 10} ft beam` : null, s.max_draft_ft ? `${s.max_draft_ft} ft draft` : null].filter(Boolean).join(" · ");
  const power = !s.has_power ? "No" : `${s.power_amps ? s.power_amps.replace("/", " / ").replace(/A/g, " amp").replace("amp /", "/") : "Yes"}${s.utilities_mode === "included" ? " · included" : s.utilities_mode === "metered" ? " · metered" : ""}`;
  const prices: [string, string | null][] = [["Monthly", price("monthly")], ["Weekly", price("transient_weekly")], ["Nightly", price("transient_daily")]];
  const extras = (s.amenities || "").split(/\s*[·|•;]\s*/).filter(Boolean);
  return (
    <>
      {fits && <div className="mr-fits">Fits boats up to <b>{fits}</b></div>}
      <div className="mr-pop-rows">
        <span>Power <b>{power}</b></span>
        <span>Water <b>{s.has_water ? "Yes" : "No"}</b></span>
      </div>
      {prices.some(([, v]) => v) && (
        <div className="mr-prices">
          {prices.filter(([, v]) => v).map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}
        </div>
      )}
      {extras.length > 0 && <div className="mr-extras">{extras.map((e) => <span key={e}>{e}</span>)}</div>}
    </>
  );
}
