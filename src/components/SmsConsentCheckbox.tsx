"use client";

// Oct 19 (per Mely — Twilio A2P 10DLC): the one "I agree to receive text
// messages" checkbox used everywhere a phone number is collected (public
// /text-messages page, rental application, resident portal). Optional and
// unchecked by default, as carriers require. Only the box itself is
// clickable (Mely's rule for checkboxes). Inline styles: Tailwind doesn't
// generate CSS in production on this site.

import { smsConsentWording } from "@/lib/smsConsentWording";
export { smsConsentWording };

export default function SmsConsentCheckbox({
  parkName,
  checked,
  onChange,
  id = "sms-consent",
}: {
  parkName: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10 }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: "pointer", accentColor: "#000" }}
      />
      <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
        <span style={{ color: "#6b7280", fontWeight: 600 }}>(Optional)</span> {smsConsentWording(parkName)}
        {/* Oct 31 (Twilio 30923): the SMS box is its own consent — not bundled with the Terms. Links are
            for reading only; leaving the box unchecked never blocks anything. */}
        <span style={{ display: "block", marginTop: 4, color: "#6b7280" }}>
          Leave this box unchecked if you don&apos;t want texts. See our{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#111", textDecoration: "underline" }}>
            SMS terms
          </a>{" "}
          and{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "#111", textDecoration: "underline" }}>
            Privacy Policy
          </a>
          .
        </span>
      </span>
    </div>
  );
}
