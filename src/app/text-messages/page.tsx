"use client";

// Oct 19 (per Mely — Twilio A2P 10DLC campaign was rejected with error 30909
// because the reviewer couldn't see where people agree to receive texts:
// the rest of the site is behind the staging password). Public SMS opt-in
// page for any company on MelyOS. Excluded from the site password in
// middleware.ts, like /terms and /privacy.

import { useState } from "react";
import { useCompany } from "@/lib/CompanyContext";
import SmsConsentCheckbox from "@/components/SmsConsentCheckbox";

export default function TextMessagesPage() {
  const { company } = useCompany();
  const name = company?.company_name || "Aloha RV Park";
  const phone = company?.contact_phone || "(689) 252-0567";
  const email = company?.contact_email || "info@aloharvparkfl.com";

  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!fullName.trim()) return setError("Please enter your name.");
    if (mobile.replace(/\D/g, "").length < 10) return setError("Please enter your 10-digit mobile number.");
    if (!agreed) return setError("Please check the box to agree to receive text messages.");
    if (!company?.id) return setError("Please try again in a moment.");
    setSending(true);
    try {
      const r = await fetch("/api/sms-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, name: fullName, phone: mobile, agreed }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d?.error || "Could not save. Please try again.");
      setDone(true);
    } finally {
      setSending(false);
    }
  }

  const input: React.CSSProperties = {
    width: "100%", border: "1.5px solid #d1d5db", borderRadius: 6, padding: "10px 12px",
    fontSize: 15, fontFamily: "inherit", boxSizing: "border-box",
  };
  const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 6 };
  const h2: React.CSSProperties = { fontSize: 20, fontWeight: 900, margin: "0 0 10px" };
  const p: React.CSSProperties = { fontSize: 15, color: "#374151", lineHeight: 1.8, margin: "0 0 10px" };

  return (
    <>
      <section style={{ background: "var(--sea)", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>
          {name}
        </div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 12 }}>Text Message Alerts</h1>
        <p style={{ fontSize: 15, color: "#4b5563", maxWidth: 620, margin: "0 auto" }}>
          Get account notices from {name} by text: invoices, payment notices, rental application
          invitations and reservation confirmations.
        </p>
      </section>

      <section style={{ padding: "60px 24px", background: "var(--cream)" }}>
        <div
          style={{
            maxWidth: 860, margin: "0 auto", background: "var(--white)", border: "2px solid var(--black)",
            borderRadius: 8, padding: "40px clamp(20px, 5vw, 48px)",
          }}
        >
          <h2 style={h2}>Sign up</h2>
          {done ? (
            <div style={{ border: "1.5px solid #16a34a", background: "#f0fdf4", borderRadius: 6, padding: 16, marginBottom: 28 }}>
              <p style={{ ...p, margin: 0, color: "#166534" }}>
                Thank you. You are signed up for text messages from {name}. Reply STOP at any time to opt out.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} style={{ marginBottom: 32 }}>
              {/* Oct 31 (per Mely — Twilio error 30923 "forced consent"): say plainly that texts are
                  optional and give a way to skip; the checkbox is separate from the Terms. */}
              <div style={{ border: "1.5px solid #d1d5db", background: "#f9fafb", borderRadius: 6, padding: "12px 14px", marginBottom: 18 }}>
                <p style={{ ...p, margin: 0 }}>
                  <strong>Text messages are optional.</strong> You do not need to sign up to rent a site, apply, make a
                  reservation, pay or use the resident portal — we will still reach you by email.{" "}
                  <a href="/" style={{ color: "#111", textDecoration: "underline" }}>No thanks, skip</a>
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                <div>
                  <span style={label}>Full name</span>
                  <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </div>
                <div>
                  <span style={label}>Mobile number</span>
                  <input
                    style={input}
                    type="tel"
                    inputMode="tel"
                    placeholder="407-555-1234"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              </div>
              <SmsConsentCheckbox parkName={name} checked={agreed} onChange={setAgreed} id="sms-consent-public" />
              {error && <p style={{ color: "#b91c1c", fontSize: 14, margin: "10px 0 0" }}>{error}</p>}
              <button
                type="submit"
                disabled={sending}
                style={{
                  marginTop: 16, background: "#000", color: "#fff", border: "none", borderRadius: 6,
                  padding: "12px 24px", fontWeight: 700, fontSize: 15, cursor: "pointer", opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? "Saving..." : "Sign up for text messages (optional)"}
              </button>
            </form>
          )}

          <h2 style={h2}>Other ways to sign up</h2>
          <p style={p}>
            The same optional checkbox appears next to the phone number on our <strong>rental application</strong> and
            in the <strong>resident portal</strong>. You can also ask our office staff, in person or by phone, to sign
            you up; staff record your agreement and the date. Texts are only sent to people who agreed.
          </p>

          <h2 style={h2}>What you will receive</h2>
          <p style={p}>
            Account notices only: invoices and payment reminders, rental application invitations, and reservation
            confirmations. No marketing. Message frequency varies with your account activity. Message and data rates
            may apply.
          </p>
          <p style={{ ...p, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px" }}>
            Example: &ldquo;{name}: Your invoice for November — $600.00 due 2026-11-05. Pay here: [link]. Reply STOP to opt out.&rdquo;
          </p>

          <h2 style={h2}>Opt out or get help</h2>
          <p style={p}>
            Reply <strong>STOP</strong> to any message to stop receiving texts. You will get one confirmation and then
            no more. Reply <strong>HELP</strong> for help, or contact us at {phone} or {email}. Consent to receive text
            messages is not a condition of any rental, reservation or purchase.
          </p>
          <p style={{ ...p, margin: 0 }}>
            We do not sell or share your mobile number or text-message consent with third parties for marketing. See
            our{" "}
            <a href="/terms" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>Terms &amp; Conditions</a> and{" "}
            <a href="/privacy" style={{ color: "var(--red-dark)", textDecoration: "underline" }}>Privacy Policy</a>.
          </p>
        </div>
      </section>
    </>
  );
}
