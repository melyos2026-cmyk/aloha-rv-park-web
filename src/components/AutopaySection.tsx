"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

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

  async function handleSave() {
    if (!stripe || !elements) return;
    if (!agreed) {
      setError("Please check the box to authorize the monthly automatic charge.");
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
      if (intentError || !clientSecret) throw new Error(intentError || "Could not start card setup.");

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card field not ready.");

      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (result.error) {
        throw new Error(result.error.message || "Could not save card.");
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
      if (!confirmRes.ok) throw new Error(confirmData.error || "Could not enable autopay.");

      onSaved(confirmData.last4 || "");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
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
          Recurring Charge Authorization
        </div>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.55, margin: 0 }}>{autopayAuthorizationText(parkName)}</p>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          style={{ marginTop: 3, width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
          checked={agreed}
          onChange={(e) => { setAgreed(e.target.checked); setError(""); }}
        />
        <span style={{ fontSize: 13 }}>I have read and agree to this authorization.</span>
      </div>
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving || !stripe || !agreed}
        style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: saving || !agreed ? "default" : "pointer", opacity: saving || !agreed ? 0.6 : 1 }}
      >
        {saving ? "Saving..." : "Save Card & Enable Autopay"}
      </button>
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
}: {
  residentId: string;
  autopayEnabled: boolean;
  cardLast4: string | null;
  onChange: () => void;
  parkName?: string;
  authorizedAt?: string | null;
}) {
  const [disabling, setDisabling] = useState(false);

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

  if (autopayEnabled) {
    return (
      <div style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 4 }}>✅ Autopay is on</p>
        <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 12 }}>
          {cardLast4 ? `Card ending in ${cardLast4}` : "Card on file"} — your balance will be charged
          automatically each month.
        </p>
        {authorizedAt && (
          <p style={{ fontSize: 11, color: "var(--gray)", marginTop: -6, marginBottom: 12 }}>
            Recurring charge authorization accepted on{" "}
            {new Date(authorizedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        )}
        <button
          onClick={handleDisable}
          disabled={disabling}
          style={{ background: "none", border: "1.5px solid var(--border)", padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}
        >
          {disabling ? "Turning off..." : "Turn Off Autopay"}
        </button>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <AutopayForm residentId={residentId} parkName={parkName} onSaved={() => onChange()} />
    </Elements>
  );
}
