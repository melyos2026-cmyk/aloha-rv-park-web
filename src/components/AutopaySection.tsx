"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

function AutopayForm({ residentId, onSaved }: { residentId: string; onSaved: (last4: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!stripe || !elements) return;
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
        body: JSON.stringify({ residentId, paymentMethodId }),
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
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving || !stripe}
        style={{ background: "#16a34a", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 6, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
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
}: {
  residentId: string;
  autopayEnabled: boolean;
  cardLast4: string | null;
  onChange: () => void;
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
      <AutopayForm residentId={residentId} onSaved={() => onChange()} />
    </Elements>
  );
}
