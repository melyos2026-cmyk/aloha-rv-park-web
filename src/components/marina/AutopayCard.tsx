"use client";
import { useEffect, useState } from "react";

// Oct 26 (per Mely — Group 2): Boater login → Autopay. Save a card or a bank account once; what's
// due is paid automatically on its due date with an email receipt each time.
type St = { ready: boolean; enabled?: boolean; method?: string | null; label?: string | null; since?: string | null; failedAt?: string | null; failNote?: string | null; history?: { run_date: string; amount: number; fee: number; status: string; error: string | null }[]; due?: { number: string; amount: number; due: string }[]; bank?: boolean; terms?: { card: string; ach: string } };
const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null | undefined) => (d ? new Date(String(d).length > 10 ? d : `${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function AutopayCard() {
  const [st, setSt] = useState<St | null>(null);
  const [pick, setPick] = useState<"card" | "ach" | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = () => fetch("/api/marina/autopay", { cache: "no-store" }).then((r) => r.json()).then(setSt).catch(() => setSt({ ready: false }));

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sid = q.get("s");
    const back = q.get("autopay");
    if (back) window.history.replaceState(null, "", window.location.pathname + "#autopay");
    if (back === "done" && sid) {
      fetch("/api/marina/autopay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", session_id: sid }) })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => { if (ok) setMsg(`Autopay is on with ${j.label}.`); else setErr(j.error || "Could not save."); load(); });
    } else {
      if (back === "cancelled") setErr("Autopay was not turned on.");
      load();
    }
  }, []);

  if (!st || !st.ready) return null;

  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(""); setMsg("");
    const r = await fetch("/api/marina/autopay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Something went wrong."); return null; }
    return j;
  }
  async function start() {
    if (!pick) return;
    const j = await post({ action: "start", method: pick, agree });
    if (!j) return;
    if (j.url) { window.location.href = j.url; return; }
    setMsg("Autopay is on (demo: no card is charged)."); setPick(null); setAgree(false); load();
  }

  const due = st.due || [];
  return (
    <div className="mr-card" id="autopay">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Autopay</h3>
        {st.enabled ? <span className="mr-autopay-on">ON</span> : <span className="mr-autopay-off">OFF</span>}
      </div>
      {msg && <div className="mr-ok" style={{ marginTop: 8 }}>{msg}</div>}
      {err && <div className="mr-error" style={{ marginTop: 8 }}>{err}</div>}
      {st.enabled ? (
        <>
          <p style={{ margin: "8px 0" }}>We pay your bills automatically with <b>{st.label}</b> on their due date. You get an email receipt each time.</p>
          {st.failedAt && <div className="mr-error">The last payment didn&apos;t go through ({st.failNote}). Pay below or change your card; we try again tomorrow.</div>}
          {due.length > 0 && <p style={{ fontSize: 14 }}>Next payment: <b>{money(due.reduce((a, d) => a + d.amount, 0))}</b> for {due.map((d) => d.number).join(", ")} (tomorrow morning).</p>}
          {(st.history || []).length > 0 && (
            <div className="mr-autopay-hist">
              {(st.history || []).map((h, i) => <div key={i}><span>{day(h.run_date)}</span><span>{money(Number(h.amount) + Number(h.fee || 0))}</span><span className={h.status}>{h.status === "succeeded" ? "Paid" : h.status === "processing" ? "Bank processing" : "Failed"}</span></div>)}
            </div>
          )}
          <div className="mr-quote-btns" style={{ marginTop: 10 }}>
            <button type="button" className="mr-btn ghost mr-btn-ink" disabled={busy} onClick={() => { setPick(st.method === "ach" ? "ach" : "card"); }}>Change card or bank</button>
            <button type="button" className="mr-btn ghost mr-btn-ink" disabled={busy} onClick={async () => { if (!window.confirm("Turn off autopay? You'll pay each bill yourself.")) return; if (await post({ action: "off" })) { setMsg("Autopay is off."); load(); } }}>Turn off</button>
          </div>
        </>
      ) : !pick ? (
        <>
          <p style={{ margin: "8px 0" }}>Never miss a payment. Save a card{st.bank ? " or bank account" : ""} once and your slip fees, contract payments, electricity and store charges are paid automatically on their due date. Turn it off anytime.</p>
          <div className="mr-quote-btns">
            <button type="button" className="mr-btn dark" onClick={() => setPick("card")}>Use a card</button>
            {st.bank && <button type="button" className="mr-btn ghost mr-btn-ink" onClick={() => setPick("ach")}>Use my bank account (lower fee)</button>}
          </div>
        </>
      ) : null}
      {pick && (
        <div className="mr-docs-form" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700 }}>{pick === "ach" ? "Bank account" : "Card"} for autopay</div>
          <label className="mr-autopay-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{pick === "ach" ? st.terms?.ach : st.terms?.card}</span></label>
          <div className="mr-quote-btns">
            <button type="button" className="mr-btn dark" disabled={busy || !agree} onClick={start}>{busy ? "One moment…" : "Continue"}</button>
            <button type="button" className="mr-btn ghost mr-btn-ink" disabled={busy} onClick={() => { setPick(null); setAgree(false); }}>Cancel</button>
          </div>
          <p style={{ fontSize: 13, color: "var(--mr-muted)" }}>Your {pick === "ach" ? "bank details" : "card number"} is saved by Stripe, not by the marina.</p>
        </div>
      )}
    </div>
  );
}
