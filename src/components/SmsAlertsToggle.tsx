"use client";

// Oct 19 (per Mely — Twilio A2P 10DLC): "Text message alerts" on/off inside
// the portal's Resident Information card. Turning on requires checking the
// consent box (explicit opt-in); turning off works anytime (same as STOP).
import { useEffect, useState } from "react";
import SmsConsentCheckbox from "@/components/SmsConsentCheckbox";
import { usePortalLang } from "@/lib/portalI18n";

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
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const { lang, t, err } = usePortalLang();

  useEffect(() => {
    if (!residentId) return;
    fetch(`/api/portal/sms-consent?residentId=${residentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d ? !!d.enabled : false))
      .catch(() => setEnabled(false));
  }, [residentId, phone]);

  async function save(on: boolean) {
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/portal/sms-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, enabled: on }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ text: err(d?.error) || t("Could not save."), bad: true });
        return;
      }
      setEnabled(on);
      setAgree(false);
      setMsg({ text: t(on ? "Text message alerts are on." : "Text message alerts are off."), bad: false });
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
        <strong>{t("Text message alerts:")}</strong>{" "}
        {enabled === null ? "…" : enabled ? <span style={{ color: "#16a34a", fontWeight: 700 }}>{t("On")}</span> : t("Off")}
      </p>
      {enabled === true && (
        <button onClick={() => save(false)} disabled={busy} style={{ ...btn, background: "transparent" }}>
          {busy ? t("Saving...") : t("Turn off")}
        </button>
      )}
      {enabled === false && (
        <>
          {!phone ? (
            <p style={{ fontSize: 13, color: "var(--gray)" }}>{t("Add your mobile number above to get text alerts.")}</p>
          ) : (
            <>
              {/* The consent wording is recorded word for word (carrier rules) — it stays in English. */}
              <div lang="en"><SmsConsentCheckbox parkName={parkName || "the park"} checked={agree} onChange={setAgree} id="sms-consent-portal" /></div>
              {lang !== "en" && <p style={{ fontSize: 11.5, color: "#374151", fontStyle: "italic", margin: "4px 0 0 28px" }}>{t("This consent is in English; it is the version you agree to.")}</p>}
              <button
                onClick={() => save(true)}
                disabled={busy || !agree}
                style={{ ...btn, marginTop: 10, background: "#000", color: "#fff", opacity: busy || !agree ? 0.5 : 1 }}
              >
                {busy ? t("Saving...") : t("Turn on text alerts")}
              </button>
            </>
          )}
        </>
      )}
      {msg && <p style={{ fontSize: 13, marginTop: 8, color: msg.bad ? "#dc2626" : "#16a34a" }}>{msg.text}</p>}
    </div>
  );
}
