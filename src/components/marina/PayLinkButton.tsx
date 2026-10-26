"use client";
import { useState } from "react";

// Oct 26 (per Mely): one button that starts a payment from a private link page (booking balance,
// slip request answers). Posts to `url`, then goes to Stripe (or reloads on a demo marina).
export default function PayLinkButton({ url, body, label, className = "mr-btn dark" }: { url: string; body: Record<string, unknown>; label: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div>
      <button type="button" className={className} disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        try {
          const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
          if (j.url) { window.location.href = j.url; return; }
          window.location.reload();
        } catch (e: any) { setErr(e.message); setBusy(false); }
      }}>{busy ? "One moment…" : label}</button>
      {err && <div className="mr-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}
