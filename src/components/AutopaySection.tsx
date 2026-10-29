"use client";

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { bankAutopayAuthorizationText } from "@/lib/autopayTerms";
import { usePortalLang } from "@/lib/portalI18n";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

// Oct 19 (per Mely — Aloha's paper "Credit Card Authorization Form"):
// the resident must accept a written recurring-charge authorization before
// the card is saved; the exact text and the time are stored as proof.
export function autopayAuthorizationText(parkName: string) {
  const park = parkName || "the park";
  return `I authorize ${park} to automatically charge this card each month for the balance of my monthly invoice (rent, utilities, fees and any other charges on my resident account) until I turn off autopay in my resident portal. I understand that turning off autopay only stops future automatic charges and does not cancel any amount I owe.`;
}

function AutopayForm({ residentId, parkName, onSaved }: { residentId: string; parkName: string; onSaved: (last4: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const { lang, t, err } = usePortalLang();

  async function handleSave() {
    if (!stripe || !elements) return;
    if (!agreed) {
      setError(t("Please check the box to authorize the monthly automatic charge."));
      return;
    }
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/portal/create-setup-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId }),
      });
      const { clientSecret, error: intentError } = await res.json();
      if (intentError || !clientSecret) throw new Error(err(intentError) || t("Could not start card setup."));

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error(t("Card field not ready."));

      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (result.error) {
        throw new Error(result.error.message || t("Could not save card."));
      }

      const paymentMethodId = result.setupIntent?.payment_method as string;

      const confirmRes = await fetch("/api/portal/confirm-autopay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          paymentMethodId,
          authorizationAccepted: true,
          authorizationText: autopayAuthorizationText(parkName),
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(err(confirmData.error) || t("Could not enable autopay."));

      onSaved(confirmData.last4 || "");
    } catch (e: any) {
      setError(e.message || t("Something went wrong."));
    }
    setSaving(false);
  }

  return (
    <div>
      <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 14, marginBottom: 12, minHeight: 44 }}>
        <CardElement options={{ style: { base: { fontSize: "15px" } } }} />
      </div>
      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#374151", marginBottom: 4 }}>
          {t("Recurring Charge Authorization")}
        </div>
        {/* The authorization is stored word for word as proof — it stays in English. */}
        <p lang="en" style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.55, margin: 0 }}>{autopayAuthorizationText(parkName)}</p>
        {lang !== "en" && <p style={{ fontSize: 11.5, color: "#374151", fontStyle: "italic", margin: "6px 0 0" }}>{t("This authorization is in English; it is the version you agree to.")}</p>}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
          checked={agreed}
          onChange={(e) => { setAgreed(e.target.checked); setError(""); }}
        />
        <span style={{ fontSize: 13 }}>{t("I have read and agree to this authorization.")}</span>
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving || !stripe || !agreed}
        style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: saving || !agreed ? "default" : "pointer", opacity: saving || !agreed ? 0.6 : 1 }}
      >
        {saving ? t("Saving...") : t("Save Card & Enable Autopay")}
      </button>
    </div>
  );
}

// Oct 28 (per Mely): bank (ACH) autopay is offered next to the card — listed first and recommended
// (lowest fee) — only when the park has bank payments ON. Fees come from the same constants the
// server charges with (src/lib/platformFee.ts via /api/portal/fee-settings).
export type BankAutopayOption = {
  enabled: boolean;            // park has ach_enabled === true (and autopay available)
  passFee: boolean;            // resident pays the fee (company_fee_settings.pass_processing_fee_to_resident)
  exampleAmount: number;       // e.g. the monthly rent, to show real fees
  cardFee: number;             // card fee on exampleAmount
  achFee: number;              // bank fee on exampleAmount
  achMin: number;              // bank autopay pays balances at or above this
  returnFee: number;           // returned bank payment fee (bank cost; kept for older callers)
  returnFeePhrase?: string;    // Oct 28: the company's returned-payment fee rule, in words
};


function BankAutopaySetup({ residentId, parkName, bank, onCancel }: { residentId: string; parkName: string; bank: BankAutopayOption; onCancel?: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { lang, t, err, money: fmt, rich } = usePortalLang();
  async function start() {
    if (!agreed) { setError(t("Please check the box to authorize the automatic bank payments.")); return; }
    setBusy(true); setError("");
    const res = await fetch("/api/portal/bank-autopay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, action: "start", authorizationAccepted: true }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j.url) { setBusy(false); setError(err(j.error) || t("Could not open the secure page. Please try again.")); return; }
    window.location.href = j.url;
  }
  // Oct 28 (per Mely — "que se vea mejor"): short checklist, the legal authorization in a tidy
  // scrollable box, and one clear full-width button.
  const point = (t: React.ReactNode) => (
    <li style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#374151", lineHeight: 1.45 }}>
      <span aria-hidden style={{ flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: 999, background: "#dcfce7", color: "#15803d", fontSize: 11, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>
      <span>{t}</span>
    </li>
  );
  return (
    <div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 8 }}>
        {point(rich("Link your checking or savings account on a <b>secure page</b> — log in to your bank, no account numbers to type."))}
        {point(rich("Each payment takes <b>3–5 business days</b> to clear."))}
        {point(rich("Balances of <b>{amount}</b> or more are paid automatically; a smaller balance is added to the next one (you can always pay it yourself).", { amount: fmt(bank.achMin) }))}
      </ul>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#374151", background: "#f9fafb", padding: "8px 12px", borderBottom: "1px solid #e5e7eb" }}>
          {t("Bank debit (ACH) authorization")}
        </div>
        {/* Built and stored word for word on the server as proof — it stays in English. */}
        <p lang="en" style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6, margin: 0, padding: "10px 12px", maxHeight: 132, overflowY: "auto" }}>{bankAutopayAuthorizationText(parkName, bank.returnFeePhrase)}</p>
        {lang !== "en" && <p style={{ fontSize: 11.5, color: "#374151", fontStyle: "italic", margin: 0, padding: "0 12px 10px" }}>{t("This authorization is in English; it is the version you agree to.")}</p>}
      </div>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
          checked={agreed}
          onChange={(e) => { setAgreed(e.target.checked); setError(""); }}
        />
        <span style={{ fontSize: 13 }}>{t("I have read and agree to this authorization.")}</span>
      </label>
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={start}
          disabled={busy || !agreed}
          style={{ flex: "1 1 220px", background: "#16a34a", color: "#fff", border: "none", padding: "12px 20px", borderRadius: 8, fontWeight: 800, fontSize: 15, cursor: busy || !agreed ? "default" : "pointer", opacity: busy || !agreed ? 0.55 : 1 }}
        >
          {busy ? t("Opening secure page...") : t("Link my bank & turn on autopay")}
        </button>
        {onCancel && (
          <button onClick={onCancel} disabled={busy} style={{ background: "none", border: "1.5px solid var(--border)", padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>
            {t("Cancel")}
          </button>
        )}
      </div>
    </div>
  );
}

function MethodChoice({ value, onChange, bank }: { value: "ach" | "card"; onChange: (v: "ach" | "card") => void; bank: BankAutopayOption }) {
  const { t, money: fmt, returnedFeeSentence } = usePortalLang();
  const lowest = bank.passFee && bank.achFee < bank.cardFee;
  const example = bank.exampleAmount > 0 ? ` ${t("on {amount}", { amount: fmt(bank.exampleAmount) })}` : "";
  const tile = (v: "ach" | "card", title: string, fee: string, sub: string, badge?: string) => {
    const on = value === v;
    return (
      <label style={{
        position: "relative", display: "block", cursor: "pointer", borderRadius: 10, padding: "14px 14px 12px",
        border: on ? "2px solid #16a34a" : "1.5px solid var(--border)", background: on ? "#f0fdf4" : "#fff",
        boxShadow: on ? "0 1px 6px rgba(22,163,74,.15)" : "none",
      }}>
        <input type="radio" name="autopay-method" checked={on} onChange={() => onChange(v)} style={{ position: "absolute", opacity: 0, pointerEvents: "none" }} />
        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{title}</span>
          <span aria-hidden style={{ width: 18, height: 18, borderRadius: 999, border: on ? "5px solid #16a34a" : "2px solid #cbd5e1", background: "#fff", flexShrink: 0 }} />
        </span>
        {badge && <span style={{ display: "inline-block", marginTop: 6, background: "#16a34a", color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{badge}</span>}
        <span style={{ display: "block", marginTop: 8, fontSize: 18, fontWeight: 900, color: "#111827" }}>{fee}</span>
        <span style={{ display: "block", fontSize: 12, color: "var(--gray)", marginTop: 2, lineHeight: 1.4 }}>{sub}</span>
      </label>
    );
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {tile("ach", t("Bank account"), bank.passFee ? t("{amount} fee", { amount: fmt(bank.achFee) }) : t("No fee"),
          `${bank.passFee ? `${example ? `${example.trim()} · ` : ""}` : ""}${lowest ? `${t("{amount} less than card", { amount: fmt(bank.cardFee - bank.achFee) })} · ` : ""}${t("clears in 3–5 business days")}`,
          lowest ? t("Recommended · lowest fee") : t("Recommended"))}
        {tile("card", t("Card"), bank.passFee ? t("{amount} fee", { amount: fmt(bank.cardFee) }) : t("No fee"), `${bank.passFee && example ? `${example.trim()} · ` : ""}${t("charged instantly")}`)}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--gray)", margin: "8px 2px 0", lineHeight: 1.45 }}>
        {returnedFeeSentence(bank.returnFeePhrase)} {t("Bank autopay is then turned off.")}
      </p>
    </div>
  );
}

export default function AutopaySection({
  residentId,
  autopayEnabled,
  cardLast4,
  onChange,
  parkName = "",
  authorizedAt = null,
  autopayMethod = null,
  bank = null,
}: {
  residentId: string;
  autopayEnabled: boolean;
  cardLast4: string | null;
  onChange: () => void;
  parkName?: string;
  authorizedAt?: string | null;
  autopayMethod?: string | null;
  bank?: BankAutopayOption | null;
}) {
  const [disabling, setDisabling] = useState(false);
  const bankOn = !!bank?.enabled;
  const [method, setMethod] = useState<"ach" | "card">(bankOn ? "ach" : "card");
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { t, err, money: fmt, dateTime } = usePortalLang();

  // Preselect bank once we learn the park offers it.
  useEffect(() => { if (bankOn) setMethod("ach"); }, [bankOn]);

  // Back from Stripe's "link your bank" page: save it and turn autopay on.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const back = q.get("bank_autopay");
    if (!back) return;
    const sid = q.get("s");
    window.history.replaceState(null, "", window.location.pathname + "#autopay");
    if (back === "cancelled") { setNotice({ ok: false, text: t("Bank autopay was not turned on.") }); return; }
    if (back !== "done" || !sid) return;
    fetch("/api/portal/bank-autopay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, action: "confirm", sessionId: sid }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        setNotice(ok ? { ok: true, text: t("Autopay is on with your bank account ending in {last4}.", { last4: j.last4 || "—" }) } : { ok: false, text: err(j.error) || t("Could not save the bank account.") });
        if (ok) { setSwitching(false); onChange(); }
      })
      .catch(() => setNotice({ ok: false, text: t("Could not save the bank account. Please try again.") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residentId]);

  async function handleDisable() {
    setDisabling(true);
    await fetch("/api/portal/disable-autopay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId }),
    });
    setDisabling(false);
    onChange();
  }

  const noticeEl = notice && (
    <p style={{ fontSize: 13, marginBottom: 10, padding: 8, borderRadius: 6, background: notice.ok ? "#f0fdf4" : "#fef2f2", color: notice.ok ? "#166534" : "#b91c1c" }}>{notice.text}</p>
  );
  const isBank = autopayMethod === "ach";

  if (autopayEnabled) {
    return (
      <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16 }}>
        {noticeEl}
        <p style={{ fontWeight: 800, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}><span aria-hidden style={{ width: 20, height: 20, borderRadius: 999, background: "#16a34a", color: "#fff", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</span>{t("Autopay is on")}</p>
        <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 12 }}>
          {isBank
            ? t("Bank account ending in {last4} — your balance is paid from your bank automatically each month (clears in 3–5 business days).", { last4: cardLast4 || "—" })
            : t("{method} — your balance will be charged automatically each month.", { method: cardLast4 ? t("Card ending in {last4}", { last4: cardLast4 }) : autopayMethod ? t("Card on file") : t("Saved payment method") })}
        </p>
        {isBank && !bankOn && (
          <p style={{ fontSize: 12.5, color: "#92400e", background: "#fffbeb", padding: 8, borderRadius: 6, marginBottom: 12 }}>
            {t("The park has paused bank payments, so autopay will not take payments from your bank until they are turned back on. Please pay your balance yourself meanwhile, or turn off autopay and set it up with a card.")}
          </p>
        )}
        {authorizedAt && (
          <p style={{ fontSize: 11, color: "var(--gray)", marginTop: -6, marginBottom: 12 }}>
            {t(isBank ? "Bank debit authorization accepted on {date}." : "Recurring charge authorization accepted on {date}.", { date: dateTime(authorizedAt, { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        )}
        {!isBank && bankOn && bank && (
          switching ? (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>{t("Switch autopay to your bank account")}</p>
              <BankAutopaySetup residentId={residentId} parkName={parkName} bank={bank} onCancel={() => setSwitching(false)} />
            </div>
          ) : (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
              <strong>{t("Pay less with your bank.")}</strong>{" "}
              {bank.passFee && bank.achFee < bank.cardFee && bank.exampleAmount > 0
                ? t("On {amount} the fee is {ach} by bank vs {card} by card.", { amount: fmt(bank.exampleAmount), ach: fmt(bank.achFee), card: fmt(bank.cardFee) })
                : t("Bank autopay is available.")}{" "}
              <button onClick={() => setSwitching(true)} style={{ background: "none", border: "none", color: "#15803d", fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0 }}>
                {t("Switch to bank autopay")}
              </button>
            </div>
          )
        )}
        <button
          onClick={handleDisable}
          disabled={disabling}
          style={{ background: "none", border: "1.5px solid var(--border)", padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
        >
          {disabling ? t("Turning off...") : t("Turn Off Autopay")}
        </button>
      </div>
    );
  }

  if (bankOn && bank) {
    return (
      <div>
        {noticeEl}
        <MethodChoice value={method} onChange={setMethod} bank={bank} />
        {method === "ach" ? (
          <BankAutopaySetup residentId={residentId} parkName={parkName} bank={bank} />
        ) : (
          <Elements stripe={stripePromise}>
            <AutopayForm residentId={residentId} parkName={parkName} onSaved={() => onChange()} />
          </Elements>
        )}
      </div>
    );
  }

  return (
    <>
      {noticeEl}
      <Elements stripe={stripePromise}>
        <AutopayForm residentId={residentId} parkName={parkName} onSaved={() => onChange()} />
      </Elements>
    </>
  );
}
