"use client";

import { useEffect, useState } from "react";
import { RV_RETURNED_ACH_FEE_DISCLOSURE } from "@/lib/autopayTerms";

// Oct 28 (per Mely): one-time announcement on the resident portal home — "pay by bank" is new and
// cheaper than a card. Shown only when the park has bank payments ON (the dashboard checks
// achEnabled, which /api/portal/fee-settings returns only for ach_enabled === true). Dismissing it is
// remembered in this browser (localStorage; if storage is blocked it simply shows again next time).
// Nothing is emailed or texted.
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

export default function BankPayBanner({
  companyId,
  exampleAmount,
  passFee,
  fees,
  canPayNow,
  canSetUpAutopay,
  hide,
  onPay,
  onAutopay,
}: {
  companyId: string;
  exampleAmount: number;
  passFee: boolean;
  fees: { cardPercent: number; cardMinimum: number; achPercent: number; achMinimum: number; achMaximum: number; achReturnFee: number };
  canPayNow: boolean;
  canSetUpAutopay: boolean;
  hide?: boolean;
  onPay: () => void;
  onAutopay: () => void;
}) {
  const key = `bank_pay_banner_dismissed_v1:${companyId || "park"}`;
  // Hidden until we know it wasn't dismissed (no flash for residents who closed it).
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(key) === "1"; } catch { /* storage blocked */ }
    setVisible(!dismissed);
  }, [key]);

  if (!visible || hide || (!canPayNow && !canSetUpAutopay)) return null;

  function dismiss() {
    setVisible(false);
    try { window.localStorage.setItem(key, "1"); } catch { /* storage blocked */ }
  }

  const amount = exampleAmount > 0 ? exampleAmount : 0;
  const cardFee = Math.round(Math.max(amount * fees.cardPercent, fees.cardMinimum) * 100) / 100;
  const achFee = Math.round(Math.min(Math.max(amount * fees.achPercent, fees.achMinimum), fees.achMaximum) * 100) / 100;
  const showSaving = passFee && amount > 0 && achFee < cardFee;

  return (
    <div
      role="region"
      aria-label="New: pay by bank"
      style={{ position: "relative", background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 10, padding: "14px 44px 14px 16px", margin: "12px 0" }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#166534" }}
      >
        ✕
      </button>
      <div style={{ fontWeight: 900, fontSize: 16, color: "#14532d", marginBottom: 4 }}>🏦 New: pay by bank — lower fee than card</div>
      <p style={{ fontSize: 13.5, color: "#166534", lineHeight: 1.5, margin: "0 0 10px" }}>
        You can now pay straight from your checking or savings account.{" "}
        {showSaving
          ? `On ${money(amount)} the fee is ${money(achFee)} by bank instead of ${money(cardFee)} by card.`
          : passFee
            ? `The bank fee is ${Math.round(fees.achPercent * 1000) / 10}% (at most ${money(fees.achMaximum)}), the card fee ${Math.round(fees.cardPercent * 1000) / 10}%.`
            : "No fee either way."}{" "}
        Bank payments take 3–5 business days to clear. {RV_RETURNED_ACH_FEE_DISCLOSURE}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canPayNow && (
          <button type="button" onClick={onPay} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "9px 16px", fontWeight: 800, cursor: "pointer" }}>
            Pay by bank
          </button>
        )}
        {canSetUpAutopay && (
          <button type="button" onClick={onAutopay} style={{ background: canPayNow ? "#fff" : "#16a34a", color: canPayNow ? "#166534" : "#fff", border: "2px solid #16a34a", borderRadius: 6, padding: "7px 14px", fontWeight: 800, cursor: "pointer" }}>
            Set up bank autopay
          </button>
        )}
      </div>
    </div>
  );
}
