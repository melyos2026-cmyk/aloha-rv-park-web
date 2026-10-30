"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { portalBackHref } from "@/components/ResidentPortalNav";
import { usePortalLang } from "@/lib/portalI18n";

type Payment = {
  id: string;
  amount: number | null;
  total_due: number | null;
  due_date: string | null;
  status: string | null;
  notes: string | null;
  charge_type: string | null;
  custom_charge: string | null;
};

type ConfirmationData = {
  limited?: boolean; // Oct 29: not signed in as this payment's resident — status only
  paymentStatus: string;
  amountPaid: number;
  receiptNumber: string;
  transactionId: string;
  paymentDate: string;
  paymentMethodBrand: string;
  paymentMethodLast4: string;
  chargesPaid: { label: string; amount: number }[];
  remainingBalance: number;
};



function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ paddingTop: 20, paddingBottom: 20, borderTop: "1px solid #e5e7eb" }}>
      <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: "#111827", fontWeight: 600, wordBreak: "break-all" }}>
        {value}
      </div>
    </div>
  );
}

function PaymentReviewContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [payments, setPayments] = useState<Payment[]>([]);
  const [message, setMessage] = useState("");

  const [confirmation, setConfirmation] = useState<ConfirmationData | null>(null);
  const [confirmationError, setConfirmationError] = useState("");

  const [loading, setLoading] = useState(true);
  const { t, money, dateTime, err } = usePortalLang();
  const fmtMoney = (value: number | null) => money(Number(value || 0));

  useEffect(() => {
    if (sessionId) {
      loadPaymentConfirmation(sessionId);
    } else {
      loadSelectedPayments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function loadPaymentConfirmation(id: string) {
    try {
      const response = await fetch(`/api/verify-payment-session?session_id=${id}`);
      const data = await response.json();

      if (!response.ok) {
        setConfirmationError(err(data.error) || t("Could not verify payment."));
        setLoading(false);
        return;
      }

      setConfirmation(data);
      localStorage.removeItem("selected_payment_ids");
      setLoading(false);
    } catch (err) {
      console.error("VERIFY PAYMENT ERROR:", err);
      setConfirmationError(t("Could not verify payment."));
      setLoading(false);
    }
  }

  async function loadSelectedPayments() {
    const savedIds = localStorage.getItem("selected_payment_ids");

    if (!savedIds) {
      setMessage(t("No charges selected."));
      setLoading(false);
      return;
    }

    const ids = JSON.parse(savedIds);

    const res = await fetch(`/api/portal/payment-review?ids=${ids.join(",")}`);
    const result = await res.json();

    if (!res.ok) {
      console.error("PAYMENT REVIEW ERROR:", result.error);
      setMessage(t("Could not load selected charges."));
      setLoading(false);
      return;
    }

    setPayments(result.payments || []);
    setLoading(false);
  }

  const total = payments.reduce((sum, p) => {
    return sum + Number(p.total_due || p.amount || 0);
  }, 0);

  function getChargeLabel(payment: Payment) {
    if (payment.charge_type === "Custom" && payment.custom_charge) {
      return payment.custom_charge;
    }
    return t(payment.charge_type || "Charge");
  }

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    border: "1px solid #16a34a",
  };

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", ...cardStyle }}>
          <p style={{ color: "#111827" }}>{t("Loading payment review...")}</p>
        </div>
      </main>
    );
  }

  const langRow = (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}><PortalLangSwitcher compact /></div>
  );

  // ================= MODO CONFIRMACION (viene de Stripe) =================
  if (sessionId) {
    if (confirmationError) {
      return (
        <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {langRow}
            <div style={{ ...cardStyle, border: "1px solid #dc2626", marginBottom: 24 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{t("Payment Verification Failed")}</h1>
              <p style={{ marginTop: 8, color: "#111827" }}>{confirmationError}</p>
            </div>
            <button
              onClick={() => (window.location.href = portalBackHref("pay"))}
              style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              {t("Back")}
            </button>
          </div>
        </main>
      );
    }

    if (!confirmation) {
      return null;
    }

    // Oct 28 (per Mely): a bank (ACH) payment is received but not cleared yet ("unpaid" until the
    // bank confirms, 3–5 business days). Don't call it successful yet.
    const bankProcessing = confirmation.paymentStatus === "unpaid";

    // Oct 29 (security review): details are only shown to the signed-in resident who paid.
    if (confirmation.limited) {
      return (
        <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            {langRow}
            <div style={{ ...cardStyle, textAlign: "center" }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>
                {confirmation.paymentStatus === "paid" ? t("Payment Received") : bankProcessing ? t("Bank Payment Received") : t("Payment Status")}
              </h1>
              <p style={{ marginTop: 8, fontSize: 14, color: "#111827" }}>
                {confirmation.paymentStatus === "paid" || bankProcessing
                  ? t("Thank you. Sign in to your resident portal to see the receipt and your balance.")
                  : t("This payment hasn't been completed. Sign in to your resident portal to check your balance.")}
              </p>
              <a href="/login" style={{ display: "inline-block", marginTop: 16, color: "#0f766e", fontWeight: 600 }}>{t("Sign in")}</a>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {langRow}
          <div style={{ ...cardStyle, marginBottom: 24 }}>
            <div style={{ textAlign: "center", paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
              <div
                style={{
                  margin: "0 auto 16px auto",
                  display: "flex",
                  height: 56,
                  width: 56,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  backgroundColor: "#d3f8e2",
                }}
              >
                <span style={{ fontSize: 24, color: "#16a34a" }}>✓</span>
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>
                {bankProcessing ? t("Bank Payment Received") : t("Payment Successful")}
              </h1>
              <p style={{ marginTop: 4, fontSize: 14, color: "#111827" }}>
                {bankProcessing
                  ? t("Your bank payment is processing and clears in 3–5 business days. Your invoices show \"Processing (bank)\" until then — there is nothing more to pay. You'll get a receipt by email once it clears.")
                  : t("Your payment has been processed successfully.")}
              </p>
            </div>

            <div style={{ paddingTop: 20, paddingBottom: 20, borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 6 }}>{bankProcessing ? t("Amount (processing)") : t("Amount Paid")}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: bankProcessing ? "#1e40af" : "#16a34a" }}>
                {fmtMoney(confirmation.amountPaid)}
              </div>
            </div>

            {confirmation.chargesPaid.length > 0 && (
              <div style={{ paddingTop: 20, paddingBottom: 20, borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 10 }}>{t("Charges Paid")}</div>
                {confirmation.chargesPaid.map((c, idx) => (
                  <div key={idx} style={{ color: "#111827", fontWeight: 600, marginBottom: 4 }}>
                    {t(c.label)} {fmtMoney(c.amount)}
                  </div>
                ))}
              </div>
            )}

            <InfoRow label={t("Receipt #")} value={confirmation.receiptNumber} />
            <InfoRow label={t("Transaction ID")} value={confirmation.transactionId} />
            <InfoRow
              label={t("Payment Date")}
              value={dateTime(confirmation.paymentDate, {
                timeZone: "America/New_York",
                dateStyle: "short",
                timeStyle: "short",
              })}
            />
            <InfoRow
              label={t("Payment method")}
              value={confirmation.paymentMethodLast4 ? `${confirmation.paymentMethodBrand.toUpperCase()} •••• ${confirmation.paymentMethodLast4}` : confirmation.paymentMethodBrand.toUpperCase()}
            />

            <div style={{ paddingTop: 20 }}>
              <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 6 }}>{t("Remaining Balance")}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>
                {fmtMoney(confirmation.remainingBalance)}
              </div>
            </div>
          </div>

          <button
            onClick={() => (window.location.href = portalBackHref("pay"))}
            style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            {t("Back")}
          </button>
        </div>
      </main>
    );
  }

  // ================= MODO SELECTOR (flujo original) =================
  return (
    <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {langRow}
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{ paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>{t("Payment Review")}</h1>
            <p style={{ marginTop: 4, fontSize: 14, color: "#111827" }}>
              {t("Review your selected charges before payment.")}
            </p>
          </div>

          {message && (
            <div style={{ backgroundColor: "#fefce8", borderRadius: 8, padding: 16, fontSize: 14, color: "#854d0e", marginTop: 24 }}>
              {message}
            </div>
          )}

          <div style={{ paddingTop: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "#111827", marginBottom: 16 }}>{t("Selected Charges")}</h2>

            {payments.length === 0 ? (
              <p style={{ color: "#111827" }}>{t("No selected charges found.")}</p>
            ) : (
              <div>
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      padding: 16,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: 600, color: "#111827" }}>{getChargeLabel(payment)}</p>
                      {payment.notes && (
                        <p style={{ fontSize: 14, color: "#111827" }}>{payment.notes}</p>
                      )}
                    </div>
                    <p style={{ fontWeight: 700, color: "#111827" }}>
                      {fmtMoney(Number(payment.total_due || payment.amount || 0))}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <p style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>{t("Total Due")}</p>
                <p style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>{fmtMoney(total)}</p>
              </div>

              <button
                onClick={() => (window.location.href = portalBackHref("pay"))}
                style={{
                  width: "100%",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontWeight: 600,
                  color: "#ffffff",
                  backgroundColor: "#16a34a",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {t("Go to Dashboard to Pay")}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => (window.location.href = portalBackHref("pay"))}
          style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          {t("Back")}
        </button>
      </div>
    </main>
  );
}

function LoadingText() {
  const { t } = usePortalLang();
  return <>{t("Loading payment review...")}</>;
}

export default function PaymentReviewPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", backgroundColor: "#ffffff", borderRadius: 12, padding: 32, border: "1px solid #16a34a" }}>
            <p style={{ color: "#111827" }}><LoadingText /></p>
          </div>
        </main>
      }
    >
      <PaymentReviewContent />
    </Suspense>
  );
}
