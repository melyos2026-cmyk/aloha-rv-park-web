"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

function formatMoney(value: number | null) {
  return `$${Number(value || 0).toFixed(2)}`;
}

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
        setConfirmationError(data.error || "Could not verify payment.");
        setLoading(false);
        return;
      }

      setConfirmation(data);
      localStorage.removeItem("selected_payment_ids");
      setLoading(false);
    } catch (err) {
      console.error("VERIFY PAYMENT ERROR:", err);
      setConfirmationError("Could not verify payment.");
      setLoading(false);
    }
  }

  async function loadSelectedPayments() {
    const savedIds = localStorage.getItem("selected_payment_ids");

    if (!savedIds) {
      setMessage("No charges selected.");
      setLoading(false);
      return;
    }

    const ids = JSON.parse(savedIds);

    const { data, error } = await supabase
      .from("resident_payments")
      .select("*")
      .in("id", ids)
      .eq("status", "Pending");

    if (error) {
      console.error("PAYMENT REVIEW ERROR:", error);
      setMessage("Could not load selected charges.");
      setLoading(false);
      return;
    }

    setPayments(data || []);
    setLoading(false);
  }

  const total = payments.reduce((sum, p) => {
    return sum + Number(p.total_due || p.amount || 0);
  }, 0);

  function getChargeLabel(payment: Payment) {
    if (payment.charge_type === "Custom" && payment.custom_charge) {
      return payment.custom_charge;
    }
    return payment.charge_type || "Charge";
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
          <p style={{ color: "#111827" }}>Loading payment review...</p>
        </div>
      </main>
    );
  }

  // ================= MODO CONFIRMACION (viene de Stripe) =================
  if (sessionId) {
    if (confirmationError) {
      return (
        <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{ ...cardStyle, border: "1px solid #dc2626", marginBottom: 24 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>Payment Verification Failed</h1>
              <p style={{ marginTop: 8, color: "#111827" }}>{confirmationError}</p>
            </div>
            <button
              onClick={() => (window.location.href = "/residents/payments")}
              style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            >
              Back to Payments
            </button>
          </div>
        </main>
      );
    }

    if (!confirmation) {
      return null;
    }

    return (
      <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
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
              <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>Payment Successful</h1>
              <p style={{ marginTop: 4, fontSize: 14, color: "#111827" }}>
                Your payment has been processed successfully.
              </p>
            </div>

            <div style={{ paddingTop: 20, paddingBottom: 20, borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 6 }}>Amount Paid</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#16a34a" }}>
                {formatMoney(confirmation.amountPaid)}
              </div>
            </div>

            {confirmation.chargesPaid.length > 0 && (
              <div style={{ paddingTop: 20, paddingBottom: 20, borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 10 }}>Charges Paid</div>
                {confirmation.chargesPaid.map((c, idx) => (
                  <div key={idx} style={{ color: "#111827", fontWeight: 600, marginBottom: 4 }}>
                    {c.label} {formatMoney(c.amount)}
                  </div>
                ))}
              </div>
            )}

            <InfoRow label="Receipt #" value={confirmation.receiptNumber} />
            <InfoRow label="Transaction ID" value={confirmation.transactionId} />
            <InfoRow label="Payment Date" value={new Date(confirmation.paymentDate).toLocaleString()} />
            <InfoRow
              label="Payment Method"
              value={`${confirmation.paymentMethodBrand.toUpperCase()} •••• ${confirmation.paymentMethodLast4}`}
            />

            <div style={{ paddingTop: 20 }}>
              <div style={{ fontWeight: 700, color: "#374151", fontSize: 14, marginBottom: 6 }}>Remaining Balance</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>
                {formatMoney(confirmation.remainingBalance)}
              </div>
            </div>
          </div>

          <button
            onClick={() => (window.location.href = "/residents/payments")}
            style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Back to Payments
          </button>
        </div>
      </main>
    );
  }

  // ================= MODO SELECTOR (flujo original) =================
  return (
    <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <div style={{ paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>Payment Review</h1>
            <p style={{ marginTop: 4, fontSize: 14, color: "#111827" }}>
              Review your selected charges before payment.
            </p>
          </div>

          {message && (
            <div style={{ backgroundColor: "#fefce8", borderRadius: 8, padding: 16, fontSize: 14, color: "#854d0e", marginTop: 24 }}>
              {message}
            </div>
          )}

          <div style={{ paddingTop: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: "#111827", marginBottom: 16 }}>Selected Charges</h2>

            {payments.length === 0 ? (
              <p style={{ color: "#111827" }}>No selected charges found.</p>
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
                      {formatMoney(Number(payment.total_due || payment.amount || 0))}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #e5e7eb" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <p style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>Total Due</p>
                <p style={{ fontSize: 28, fontWeight: 700, color: "#111827" }}>{formatMoney(total)}</p>
              </div>

              <button
                onClick={() => (window.location.href = "/residents/dashboard")}
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
                Go to Dashboard to Pay
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={() => (window.location.href = "/residents/payments")}
          style={{ fontSize: 14, color: "#111827", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Back to Payments
        </button>
      </div>
    </main>
  );
}

export default function PaymentReviewPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#e1f8f7" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", backgroundColor: "#ffffff", borderRadius: 12, padding: 32, border: "1px solid #16a34a" }}>
            <p style={{ color: "#111827" }}>Loading payment review...</p>
          </div>
        </main>
      }
    >
      <PaymentReviewContent />
    </Suspense>
  );
}
