"use client";
import { useState } from "react";
import { rvFitsPark, tooBigMessage, type ParkLimits } from "@/lib/rvWaitlistFit";

// Oct 28 (per Mely): shown on the RV park homepage only when the park is full (every lot taken,
// storage spaces not counted). Sends the visitor to the office's Waitlist screen.
const field: React.CSSProperties = { width: "100%", padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 15, background: "#fff", color: "#111827" };
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "#4b5563", marginBottom: 6 };

// Oct 28 (per Mely): the RV's size is required. It is checked right away against the park's lots
// (limits come from GET /api/rv-waitlist); the API checks it again.
const SLIDE_OPTIONS = [["0", "0 (none)"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4 or more"]];

export default function RvWaitlist({ parkName, limits }: { parkName?: string; limits?: ParkLimits | null }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [size, setSize] = useState({ length: "", driver: "", passenger: "" });

  const len = Number(size.length);
  const sizeReady = size.length.trim() !== "" && Number.isFinite(len) && len > 0 && size.driver !== "" && size.passenger !== "";
  const rv = { length: len, driver: Number(size.driver), passenger: Number(size.passenger) };
  const tooBig = sizeReady && !!limits && !rvFitsPark(limits, rv) ? tooBigMessage(limits, rv) : "";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (tooBig) return;
    setState("sending");
    const body = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const res = await fetch("/api/rv-waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send. Please try again.");
      setState("done");
    } catch (err: any) {
      setError(err.message || "Could not send. Please try again.");
      setState("idle");
    }
  }

  return (
    <section id="waitlist" style={{ padding: "72px 24px", background: "var(--offwhite)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>We&apos;re full right now</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900 }}>Join the Waitlist</h2>
          <p style={{ fontSize: 15, color: "var(--gray)", marginTop: 12, lineHeight: 1.6 }}>
            Every lot at {parkName || "the park"} is taken today. Leave your details and the office will contact you as soon as a lot that fits your RV opens up.
          </p>
        </div>

        {state === "done" ? (
          <div role="status" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", borderRadius: 8, padding: 20, textAlign: "center", fontWeight: 600 }}>
            You&apos;re on the list! The office will contact you when a lot opens up. Thank you.
          </div>
        ) : (
          <form onSubmit={submit} style={{ background: "#fff", borderRadius: 8, padding: "clamp(20px, 4vw, 32px)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)", display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {/* honeypot */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
            <label><span style={label}>Full name *</span><input name="full_name" required minLength={2} maxLength={120} style={field} autoComplete="name" /></label>
            <label><span style={label}>Email *</span><input name="email" type="email" required maxLength={160} style={field} autoComplete="email" /></label>
            <label><span style={label}>Phone</span><input name="phone" type="tel" maxLength={40} style={field} autoComplete="tel" /></label>
            <label><span style={label}>Stay</span>
              <select name="stay_type" defaultValue="monthly" style={field}>
                <option value="monthly">Monthly</option><option value="seasonal">Seasonal</option><option value="annual">Annual</option>
              </select>
            </label>
            <label><span style={label}>RV length (ft) *</span><input name="rv_length_ft" type="number" min={1} max={99} step="0.5" required inputMode="decimal" style={field} placeholder="e.g. 38" value={size.length} onChange={(e) => setSize({ ...size, length: e.target.value })} /></label>
            <label><span style={label}>Driver-side slide-outs *</span>
              <select name="rv_driver_slide_outs" required style={field} value={size.driver} onChange={(e) => setSize({ ...size, driver: e.target.value })}>
                <option value="" disabled>Select…</option>
                {SLIDE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label><span style={label}>Passenger-side slide-outs *</span>
              <select name="rv_passenger_slide_outs" required style={field} value={size.passenger} onChange={(e) => setSize({ ...size, passenger: e.target.value })}>
                <option value="" disabled>Select…</option>
                {SLIDE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            {tooBig && (
              <div role="alert" style={{ gridColumn: "1 / -1", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
                {tooBig}
              </div>
            )}
            <label><span style={label}>RV type</span><input name="rv_type" maxLength={60} style={field} placeholder="Fifth wheel, Class A…" /></label>
            <label><span style={label}>Power needed</span>
              <select name="amp_needed" defaultValue="" style={field}>
                <option value="">Not sure</option><option value="30A">30 amp</option><option value="50A">50 amp</option>
              </select>
            </label>
            <label><span style={label}>Move-in date (approx.)</span><input name="desired_start" type="date" style={field} /></label>
            <label style={{ gridColumn: "1 / -1" }}><span style={label}>Pets</span><input name="pets" maxLength={200} style={field} placeholder="e.g. 1 small dog" /></label>
            <label style={{ gridColumn: "1 / -1" }}><span style={label}>Anything else?</span><textarea name="notes" maxLength={1000} rows={3} style={{ ...field, resize: "vertical" }} /></label>
            {error && <div role="alert" style={{ gridColumn: "1 / -1", color: "#b91c1c", fontSize: 14, fontWeight: 600 }}>{error}</div>}
            <div style={{ gridColumn: "1 / -1", textAlign: "center" }}>
              <button type="submit" disabled={state === "sending" || !!tooBig} style={{ background: "var(--red)", color: "#fff", padding: "14px 36px", border: 0, borderRadius: 4, fontWeight: 700, fontSize: 15, letterSpacing: "0.05em", textTransform: "uppercase", cursor: state === "sending" || tooBig ? "not-allowed" : "pointer", opacity: state === "sending" || tooBig ? 0.6 : 1 }}>
                {state === "sending" ? "Sending…" : "Join the Waitlist"}
              </button>
              <p style={{ fontSize: 12, color: "var(--gray)", marginTop: 10 }}>Joining the waitlist doesn&apos;t reserve a lot or charge anything.</p>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
