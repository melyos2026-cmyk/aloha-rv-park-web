"use client";
import { useEffect, useState } from "react";

export default function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [length, setLength] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { slip: string; length: number | null };
      if (d.length) setLength(String(d.length));
      setNotes(`Interested in slip ${d.slip}.`);
    };
    window.addEventListener("mr-pick-slip", h);
    return () => window.removeEventListener("mr-pick-slip", h);
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setState("sending");
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries()) as Record<string, unknown>;
    body.notes = notes;
    body.boat_length_ft = length;
    try {
      const res = await fetch("/api/marina/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send. Please try again.");
      setState("done");
    } catch (err: any) {
      setError(err.message || "Could not send. Please try again.");
      setState("idle");
    }
  }

  if (state === "done")
    return <div className="mr-ok" role="status">You are on the list. The marina office will email you when a slip that fits your boat opens.</div>;

  return (
    <form className="mr-form" onSubmit={submit}>
      <div className="two">
        <label>Full name<input type="text" name="full_name" required autoComplete="name" /></label>
        <label>Email<input type="email" name="email" required autoComplete="email" /></label>
      </div>
      <div className="two">
        <label>Phone<input type="tel" name="phone" autoComplete="tel" /></label>
        <label>Boat name<input type="text" name="boat_name" /></label>
      </div>
      <div className="two">
        <label>Boat length (ft)<input type="number" name="boat_length_ft_visible" inputMode="decimal" min="0" value={length} onChange={(e) => setLength(e.target.value)} /></label>
        <label>
          Stay type
          <select name="desired_contract_type" defaultValue="annual">
            <option value="annual">Annual</option>
            <option value="seasonal">Seasonal</option>
            <option value="monthly">Monthly</option>
            <option value="transient">Short visit</option>
          </select>
        </label>
      </div>
      {/* Oct 26 (per Mely): size and power so the automatic waitlist offers only slips that fit. */}
      <div className="two">
        <label>Beam (ft)<input type="number" name="boat_beam_ft" inputMode="decimal" min="0" step="0.1" /></label>
        <label>Draft (ft)<input type="number" name="boat_draft_ft" inputMode="decimal" min="0" step="0.1" /></label>
      </div>
      <label>
        Shore power you need
        <select name="power_needed" defaultValue="">
          <option value="">Not needed / not sure</option>
          <option value="30A">30 amp</option>
          <option value="50A">50 amp</option>
          <option value="100A">100 amp</option>
        </select>
      </label>
      <label>Anything the office should know<textarea name="notes_visible" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="mr-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
      {error && <div className="mr-error" role="alert">{error}</div>}
      <div><button className="mr-btn dark" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Join the waitlist"}</button></div>
    </form>
  );
}
