"use client";
import { useEffect, useMemo, useState } from "react";
import type { PublicSlip } from "@/lib/marina/data";

type Stay = "transient_daily" | "transient_weekly" | "monthly";
const STAYS: { key: Stay; title: string; unit: string; max: number }[] = [
  { key: "transient_daily", title: "By the night", unit: "night", max: 30 },
  { key: "transient_weekly", title: "By the week", unit: "week", max: 8 },
  { key: "monthly", title: "By the month", unit: "month", max: 12 },
];
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

type Summary = { slip: string; dock: string | null; start: string; end: string; amount: number; invoice: string };

export default function ReserveModal({ slip, startDate, onClose }: { slip: PublicSlip; startDate?: string; onClose: () => void }) {
  const minDate = slip.status === "occupied" && slip.available_from && slip.available_from > todayISO() ? slip.available_from : todayISO();
  const offered = useMemo(
    () => STAYS.filter((s) => { const r = slip.rates[s.key]; return r && (r.non_resident ?? r.resident); }),
    [slip],
  );
  const [stay, setStay] = useState<Stay>(offered[0]?.key ?? "transient_daily");
  const [units, setUnits] = useState(1);
  const [start, setStart] = useState(startDate && startDate > minDate ? startDate : minDate);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);

  const cur = STAYS.find((s) => s.key === stay)!;
  const rate = slip.rates[stay];
  const unitPrice = rate ? rate.non_resident ?? rate.resident ?? 0 : 0;
  const total = unitPrice * units;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setState("sending");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, unknown>;
    Object.assign(body, { slip_id: slip.id, stay_type: stay, units, start_date: start });
    try {
      const res = await fetch("/api/marina/reserve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not complete your reservation. Please try again.");
      if (data.url) { window.location.href = data.url; return; }
      setSummary(data.summary);
      setDemo(!!data.demo);
      setState("done");
    } catch (err: any) {
      setError(err.message || "Could not complete your reservation. Please try again.");
      setState("idle");
    }
  }

  const fmtDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="mr-modal-back" onClick={onClose} role="presentation">
      <div className="mr-modal" role="dialog" aria-modal="true" aria-label={`Reserve slip ${slip.slip_name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mr-modal-x" onClick={onClose} aria-label="Close">×</button>
        {state === "done" && summary ? (
          <div className="mr-modal-body">
            <h3 className="mr-modal-h">Slip {summary.slip} is reserved</h3>
            <div className="mr-ok" role="status">
              {demo ? "Demo payment recorded. No card was charged." : "Payment received."}
            </div>
            <dl className="mr-sum">
              <div><dt>Slip</dt><dd>{summary.slip}{summary.dock ? ` · ${summary.dock}` : ""}</dd></div>
              <div><dt>Arrive</dt><dd>{fmtDate(summary.start)}</dd></div>
              <div><dt>Depart</dt><dd>{fmtDate(summary.end)}</dd></div>
              <div><dt>Total</dt><dd>{money(summary.amount)}</dd></div>
              <div><dt>Confirmation</dt><dd>{summary.invoice}</dd></div>
            </dl>
            <p className="mr-note">{demo ? "On a live marina site the guest receives a confirmation email and the dock office sees this booking right away." : "A confirmation email is on its way. The dock office will contact you with arrival details."}</p>
            <button type="button" className="mr-btn dark" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form className="mr-modal-body" onSubmit={submit}>
            <h3 className="mr-modal-h">Reserve slip {slip.slip_name}</h3>
            <div className="mr-pop-sub">
              {slip.slip_type === "dry" ? "Dry storage" : slip.slip_type === "lift" ? "Lift slip" : "Wet slip"}
              {slip.dock ? ` · ${slip.dock}` : ""}{slip.length_ft ? ` · up to ${slip.length_ft} ft` : ""}
            </div>

            {slip.booked.length > 0 && (
              <p className="mr-note">Already booked: {slip.booked.slice(0, 4).map(([a, b]) => `${fmtDate(a)} to ${fmtDate(b)}`).join("; ")}. Pick other dates.</p>
            )}
            {offered.length === 0 ? (
              <p className="mr-note">Online booking is not offered for this slip yet. Call the dock office to reserve it.</p>
            ) : (
              <>
                <div className="mr-seg" role="group" aria-label="Length of stay">
                  {offered.map((s) => (
                    <button key={s.key} type="button" aria-pressed={stay === s.key} onClick={() => { setStay(s.key); setUnits(1); }}>
                      {s.title}
                      <small>{money(slip.rates[s.key]!.non_resident ?? slip.rates[s.key]!.resident ?? 0)}</small>
                    </button>
                  ))}
                </div>
                <div className="two">
                  <label>Arrival date<input type="date" required min={minDate} value={start} onChange={(e) => setStart(e.target.value)} /></label>
                  <label>
                    How many {cur.unit}s
                    <input type="number" required min={1} max={cur.max} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(cur.max, Math.floor(Number(e.target.value)) || 1)))} />
                  </label>
                </div>
                <div className="two">
                  <label>Boat name<input type="text" name="boat_name" autoComplete="off" /></label>
                  <label>Length (ft)<input type="number" name="boat_length_ft" required min="1" step="0.1" inputMode="decimal" /></label>
                </div>
                <div className="two">
                  <label>Beam (ft)<input type="number" name="boat_beam_ft" min="0" step="0.1" inputMode="decimal" /></label>
                  <label>Draft (ft)<input type="number" name="boat_draft_ft" min="0" step="0.1" inputMode="decimal" /></label>
                </div>
                <label>Full name<input type="text" name="guest_name" required autoComplete="name" /></label>
                <div className="two">
                  <label>Email<input type="email" name="guest_email" required autoComplete="email" /></label>
                  <label>Phone<input type="tel" name="guest_phone" required autoComplete="tel" /></label>
                </div>
                <div className="mr-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
                <div className="mr-total">
                  <span>{units} {cur.unit}{units > 1 ? "s" : ""} × {money(unitPrice)}</span>
                  <b>{money(total)}</b>
                </div>
                {error && <div className="mr-error" role="alert">{error}</div>}
                <button type="submit" className="mr-btn dark" disabled={state === "sending"}>
                  {state === "sending" ? "Processing…" : `Pay ${money(total)} and reserve`}
                </button>
                <p className="mr-note">Taxes and card fees, if any, are shown at checkout. Demo sites do not charge a card.</p>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
