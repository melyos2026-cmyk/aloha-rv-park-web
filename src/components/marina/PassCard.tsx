"use client";
import { useEffect, useState } from "react";

// Oct 26 (per Mely): the boater pass — show this QR at the ship store or fuel dock; the cashier
// scans it and the sale goes to your account. "New code" turns off the old one.
export default function PassCard() {
  const [p, setP] = useState<{ qr: string; code: string; name?: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { fetch("/api/marina/pass", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.qr) setP(j); }).catch(() => {}); }, []);
  if (!p) return null;
  return (
    <div className="mr-card mr-pass">
      <div>
        <h3 style={{ margin: 0 }}>Your marina pass</h3>
        <p className="mr-note" style={{ margin: "4px 0 0" }}>Show it at the ship store or fuel dock — they scan it instead of asking your name.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="mr-btn dark" onClick={() => setOpen(true)}>Show my pass</button>
          <button className="mr-btn ghost mr-btn-ink" onClick={async () => { if (!confirm("Make a new code? The old QR will stop working.")) return; const r = await fetch("/api/marina/pass", { method: "POST" }); const j = await r.json(); if (j.qr) setP((x) => ({ ...x!, ...j })); }}>New code</button>
        </div>
      </div>
      <img src={p.qr} alt="Marina pass QR code" width={96} height={96} style={{ borderRadius: 8 }} />
      {open && (
        <div className="mr-modal-back" onClick={() => setOpen(false)} role="presentation">
          <div className="mr-modal" style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mr-modal-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
            <div className="mr-modal-body" style={{ justifyItems: "center" }}>
              <h3 className="mr-modal-h">{p.name || "Marina pass"}</h3>
              <img src={p.qr} alt="Marina pass QR code" style={{ width: "min(80vw, 320px)", height: "auto" }} />
              <p className="mr-note">Turn up your screen brightness. The cashier scans this code.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
