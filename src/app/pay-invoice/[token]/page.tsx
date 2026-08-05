"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type InvoiceInfo = {
  lotName: string | null;
  invoiceMonth: string;
  amountDue: number;
  dueDate: string;
  status: string;
};

function PayInvoiceContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params?.token as string;
  const paidStatus = searchParams.get("paid");

  const [info, setInfo] = useState<InvoiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/guest-invoice-info?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setInfo(data);
        }
      })
      .catch(() => setError("Could not load this payment link."))
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePay() {
    setPaying(true);
    setError("");
    try {
      const res = await fetch("/api/create-guest-invoice-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start payment.");
        setPaying(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start payment. Please try again.");
      setPaying(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div
          style={{
            borderRadius: 12,
            background: "#fff",
            padding: 32,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            border: "1px solid #e5e7eb",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#000", marginBottom: 8 }}>
            Aloha RV Park — Pay Invoice
          </h1>

          {paidStatus === "success" && (
            <p style={{ background: "#dcfce7", color: "#166534", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              ✅ Payment received — thank you!
            </p>
          )}
          {paidStatus === "cancelled" && (
            <p style={{ background: "#fef9c3", color: "#854d0e", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              Payment was cancelled. You can try again below.
            </p>
          )}

          {loading && <p style={{ color: "#555" }}>Loading...</p>}

          {!loading && error && (
            <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>
          )}

          {!loading && info && info.status !== "Paid" && (
            <>
              <p style={{ color: "#555", fontSize: 14, marginBottom: 20 }}>
                You're paying an outstanding balance for a resident at Aloha RV Park.
                For their privacy, this page only shows the amount due — not their name or full account.
              </p>

              <div style={{ background: "#f9fafb", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                {info.lotName && (
                  <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                    <strong>Lot:</strong> {info.lotName}
                  </p>
                )}
                <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                  <strong>Invoice:</strong> {info.invoiceMonth}
                </p>
                <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                  <strong>Due Date:</strong> {info.dueDate}
                </p>
                <p style={{ margin: "10px 0 0", fontSize: 22, fontWeight: 800, color: "#000" }}>
                  ${info.amountDue.toFixed(2)}
                </p>
              </div>

              <button
                onClick={handlePay}
                disabled={paying}
                style={{
                  width: "100%",
                  background: paying ? "#9ca3af" : "#16a34a",
                  color: "#fff",
                  border: "none",
                  padding: "14px 0",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: paying ? "default" : "pointer",
                }}
              >
                {paying ? "Redirecting to payment..." : `Pay $${info.amountDue.toFixed(2)}`}
              </button>
            </>
          )}

          {!loading && info && info.status === "Paid" && (
            <p style={{ background: "#dcfce7", color: "#166534", padding: 12, borderRadius: 8, fontSize: 14 }}>
              ✅ This invoice has already been paid — nothing due.
            </p>
          )}
        </div>

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 11, marginTop: 16 }}>
          Powered by MelyOS.io
        </p>
      </div>
    </main>
  );
}

export default function PayInvoicePage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <p style={{ color: "#555" }}>Loading...</p>
          </div>
        </main>
      }
    >
      <PayInvoiceContent />
    </Suspense>
  );
}
