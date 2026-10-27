"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Oct 26 (per Mely — work orders): Approve (type your name + agree) or Decline (reason) an estimate.
export default function WorkOrderApprove({ number, token, total, owner, lien = "" }: { number: string; token: string; total: string; owner: string; lien?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "decline">("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(action: "approve" | "decline") {
    setBusy(true); setErr("");
    const r = await fetch("/api/marina/work-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number, token, action, name, agree, reason }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Something went wrong. Please try again."); return; }
    router.refresh();
  }

  return (
    <div className="mr-wo-approve">
      {mode === "decline" ? (
        <>
          <label className="mr-wo-label">Why are you declining? (optional)</label>
          <textarea className="mr-wo-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Too expensive, I'll do it later, I have questions…" />
          <input className="mr-wo-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <div className="mr-wo-actions">
            <button type="button" className="mr-btn" disabled={busy} onClick={() => setMode("")}>Back</button>
            <button type="button" className="mr-btn mr-wo-decline" disabled={busy} onClick={() => send("decline")}>{busy ? "Sending…" : "Decline estimate"}</button>
          </div>
        </>
      ) : (
        <>
          <label className="mr-wo-label">Type your full name to approve</label>
          <input className="mr-wo-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={owner || "Full name"} autoComplete="name" />
          <label className="mr-wo-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I approve this work for <b>{total}</b> and agree to pay it when it&apos;s done. If more work is needed, the marina will ask me first.{lien ? " I have read the lien notice below." : ""}</label>
          {lien && <p className="mr-note" style={{ fontSize: 12.5, margin: "6px 0 0" }}>{lien}</p>}
          <div className="mr-wo-actions">
            <button type="button" className="mr-btn dark" disabled={busy || name.trim().length < 3 || !agree} onClick={() => send("approve")}>{busy ? "Approving…" : `Approve ${total}`}</button>
            <button type="button" className="mr-wo-link" disabled={busy} onClick={() => setMode("decline")}>Decline</button>
          </div>
        </>
      )}
      {err && <p className="mr-wo-err">{err}</p>}
    </div>
  );
}
