"use client";

// Oct 19 (per Mely — Twilio A2P 10DLC): "Text message alerts" on/off inside
// the portal's Resident Information card. Turning on requires checking the
// consent box (explicit opt-in); turning off works anytime (same as STOP).
import { useEffect, useState } from "react";
import SmsConsentCheckbox from "@/components/SmsConsentCheckbox";

export default function SmsAlertsToggle({
  residentId,
  parkName,
  phone,
}: {
  residentId: string;
  parkName: string;
  phone: string | null | undefined;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!residentId) return;
    fetch(`/api/portal/sms-consent?residentId=${residentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d ? !!d.enabled : false))
      .catch(() => setEnabled(false));
  }, [residentId, phone]);

  async function save(on: boolean) {
    setMsg("");
    setBusy(true);
    try {
      const r = await fetch("/api/portal/sms-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, enabled: on }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d?.error || "Could not save.");
        return;
      }
      setEnabled(on);
      setAgree(false);
      setMsg(on ? "Text message alerts are on." : "Text message alerts are off.");
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = {
    border: "1.5px solid #000", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <p style={{ marginBottom: 6 }}>
        <strong>Text message alerts:</strong>{" "}
        {enabled === null ? "…" : enabled ? <span style={{ color: "#16a34a", fontWeight: 700 }}>On</span> : "Off"}
      </p>
      {enabled === true && (
        <button onClick={() => save(false)} disabled={busy} style={{ ...btn, background: "transparent" }}>
          {busy ? "Saving..." : "Turn off"}
        </button>
      )}
      {enabled === false && (
        <>
          {!phone ? (
            <p style={{ fontSize: 13, color: "var(--gray)" }}>Add your mobile number above to get text alerts.</p>
          ) : (
            <>
              <SmsConsentCheckbox parkName={parkName || "the park"} checked={agree} onChange={setAgree} id="sms-consent-portal" />
              <button
                onClick={() => save(true)}
                disabled={busy || !agree}
                style={{ ...btn, marginTop: 10, background: "#000", color: "#fff", opacity: busy || !agree ? 0.5 : 1 }}
              >
                {busy ? "Saving..." : "Turn on text alerts"}
              </button>
            </>
          )}
        </>
      )}
      {msg && <p style={{ fontSize: 13, marginTop: 8, color: msg.startsWith("Could") || msg.startsWith("Add") ? "#dc2626" : "#16a34a" }}>{msg}</p>}
    </div>
  );
}
