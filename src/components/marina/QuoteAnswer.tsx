"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Oct 26 (per Mely — price before contract): Accept / No thanks on the slip request page.
export default function QuoteAnswer({ number, t, total }: { number: string; t: string; total: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [no, setNo] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  async function send(answer: "accept" | "decline") {
    setBusy(true); setErr("");
    const r = await fetch("/api/marina/slip-request/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number, t, answer, reason }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Something went wrong. Please try again."); return; }
    router.refresh();
  }
  return (
    <div className="mr-quote-answer">
      {!no ? (
        <div className="mr-quote-btns">
          <button type="button" className="mr-btn dark" disabled={busy} onClick={() => send("accept")}>{busy ? "One moment…" : `Accept the price, ${total}`}</button>
          <button type="button" className="mr-btn ghost mr-btn-ink" disabled={busy} onClick={() => setNo(true)}>No thanks</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="mr-wo-label">Tell the marina why (optional)<textarea className="mr-wo-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Example: I found a slip closer to home." /></label>
          <div className="mr-quote-btns">
            <button type="button" className="mr-btn dark" disabled={busy} onClick={() => send("decline")}>{busy ? "One moment…" : "Send my answer"}</button>
            <button type="button" className="mr-btn ghost mr-btn-ink" disabled={busy} onClick={() => setNo(false)}>Back</button>
          </div>
        </div>
      )}
      {err && <div className="mr-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
