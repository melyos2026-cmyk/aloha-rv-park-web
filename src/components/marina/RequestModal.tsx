"use client";
import { useEffect, useState } from "react";
import type { PublicSlip } from "@/lib/marina/data";
import FitBox from "./FitBox";

// Oct 26 (per Mely): request a monthly / seasonal / annual slip. The office reviews it and sends a
// contract; the boater follows every step on a private tracker page.
type Stay = "monthly" | "seasonal" | "annual";
export default function RequestModal({ slip, stay: stay0, units: units0, start: start0, boat, onClose }: { slip: PublicSlip | null; stay?: string; units?: number; start?: string; boat?: { length?: string; beam?: string; draft?: string; power?: string }; onClose: () => void }) {
  const [stay, setStay] = useState<Stay>((["monthly", "seasonal", "annual"].includes(String(stay0)) ? stay0 : "annual") as Stay);
  const [months, setMonths] = useState(units0 && stay0 !== "annual" ? units0 : stay0 === "seasonal" ? 6 : 1);
  const [start, setStart] = useState(start0 || new Date().toISOString().slice(0, 10));
  const [len, setLen] = useState(boat?.length || ""); const [beam, setBeam] = useState(boat?.beam || ""); const [draft, setDraft] = useState(boat?.draft || ""); const [power, setPower] = useState(boat?.power || "");
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ number: string; link: string } | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); document.body.style.overflow = "hidden"; return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; }; }, [onClose]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(""); setState("sending");
    const body = { ...Object.fromEntries(new FormData(e.currentTarget).entries()), stay_type: stay, months, start_date: start, boat_length_ft: len, boat_beam_ft: beam, boat_draft_ft: draft, power_needed: power, preferred_slip_id: slip?.id, slip_type: slip?.slip_type };
    const r = await fetch("/api/marina/slip-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setState("idle");
    if (!r.ok) { setErr(j.error || "Could not send your request."); return; }
    if (j.priced && j.link) { window.location.href = j.link; return; }
    setDone({ number: j.number, link: j.link });
  }

  return (
    <div className="mr-modal-back" onClick={onClose} role="presentation">
      <div className="mr-modal" role="dialog" aria-modal="true" aria-label="Request a slip" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mr-modal-x" onClick={onClose} aria-label="Close">×</button>
        {done ? (
          <div className="mr-modal-body">
            <h3 className="mr-modal-h">Request sent</h3>
            <div className="mr-ok" role="status">Your request number is <b>{done.number}</b>.</div>
            <p>The office will review it and send you the price. You&apos;ll accept it, sign the contract and pay the deposit online. Follow every step on your tracker page; we also emailed you the link.</p>
            <a className="mr-btn dark" href={done.link}>Track my request</a>
          </div>
        ) : (
          <form className="mr-modal-body" onSubmit={submit}>
            <h3 className="mr-modal-h">{slip ? `Request slip ${slip.slip_name}` : "Request a slip"}</h3>
            {slip && <div className="mr-pop-sub">{slip.slip_type === "dry" ? "Dry storage" : slip.slip_type === "lift" ? "Lift slip" : "Wet slip"}{slip.dock ? ` · ${slip.dock}` : ""}{slip.length_ft ? ` · up to ${slip.length_ft} ft` : ""}</div>}
            <div className="mr-seg" role="group" aria-label="Contract">
              {(["monthly", "seasonal", "annual"] as Stay[]).map((s) => <button key={s} type="button" aria-pressed={stay === s} onClick={() => { setStay(s); setMonths(s === "seasonal" ? 6 : 1); }}>{s === "monthly" ? "Monthly" : s === "seasonal" ? "Seasonal" : "Annual"}</button>)}
            </div>
            <div className="two">
              <label>Start date<input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
              {stay !== "annual" ? <label>Months<input type="number" min={1} max={stay === "seasonal" ? 9 : 11} value={months} onChange={(e) => setMonths(Math.max(1, Math.min(stay === "seasonal" ? 9 : 11, Math.floor(Number(e.target.value)) || 1)))} /></label> : <label>Length<input type="text" disabled value="12 months" /></label>}
            </div>
            <div className="two">
              <label>Boat name<input type="text" name="boat_name" autoComplete="off" /></label>
              <label>Make / model<input type="text" name="boat_make_model" autoComplete="off" /></label>
            </div>
            <div className="two">
              <label>Length (ft)*<input type="number" min="1" step="0.1" required inputMode="decimal" value={len} onChange={(e) => setLen(e.target.value)} /></label>
              <label>Beam (ft)<input type="number" min="0" step="0.1" inputMode="decimal" value={beam} onChange={(e) => setBeam(e.target.value)} /></label>
            </div>
            <div className="two">
              <label>Draft (ft)<input type="number" min="0" step="0.1" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} /></label>
              <label>Shore power<select value={power} onChange={(e) => setPower(e.target.value)}><option value="">Not needed</option><option value="30A">30 amp</option><option value="50A">50 amp</option><option value="100A">100 amp</option></select></label>
            </div>
            {slip && <FitBox slip={slip} length={Number(len)} beam={Number(beam) || null} draft={Number(draft) || null} power={power || null} />}
            <label>Full name<input type="text" name="full_name" required autoComplete="name" /></label>
            <div className="two">
              <label>Email<input type="email" name="email" required autoComplete="email" /></label>
              <label>Phone<input type="tel" name="phone" required autoComplete="tel" /></label>
            </div>
            <label>Anything we should know? (optional)<textarea name="notes" rows={2} /></label>
            <div className="mr-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
            {err && <div className="mr-error" role="alert">{err}</div>}
            <button type="submit" className="mr-btn dark" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send request"}</button>
            <p className="mr-note">No payment now. The office sends you a contract with the price from the marina&apos;s rates; you sign online and pay the deposit to confirm.</p>
          </form>
        )}
      </div>
    </div>
  );
}
