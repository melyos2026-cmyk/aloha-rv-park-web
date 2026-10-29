"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { isInvoicePayableNow, invoicePayableFrom, isPayAheadInvoice } from "@/lib/invoicePayable";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { usePortalLang } from "@/lib/portalI18n";

const PARK_NAME = "Aloha RV Park";

type InvoiceInfo = {
  lotName: string | null;
  invoiceMonth: string;
  amountDue: number;
  dueDate: string;
  status: string;
  preparingUntil?: string | null;
  preparingMessage?: string | null;
  invoiceGenerateDay?: number;
  isMoveIn?: boolean;
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
  const { t, money, dateLabel, err } = usePortalLang();

  useEffect(() => {
    if (!token) return;
    fetch(`/api/guest-invoice-info?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(err(data.error));
        } else {
          setInfo(data);
        }
      })
      .catch(() => setError(t("Could not load this payment link.")))
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
        setError(err(data.error) || t("Could not start payment."));
        setPaying(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError(t("Could not start payment. Please try again."));
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
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}><PortalLangSwitcher compact /></div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#000", marginBottom: 8 }}>
            {t("{park} — Pay Invoice", { park: PARK_NAME })}
          </h1>

          {paidStatus === "success" && (
            <p style={{ background: "#dcfce7", color: "#166534", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              {t("✅ Payment received — thank you!")}
            </p>
          )}
          {paidStatus === "cancelled" && (
            <p style={{ background: "#fef9c3", color: "#854d0e", padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              {t("Payment was cancelled. You can try again below.")}
            </p>
          )}

          {loading && <p style={{ color: "#555" }}>{t("Loading...")}</p>}

          {!loading && error && (
            <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>
          )}

          {!loading && info && info.status === "Processing" && (
            <p style={{ background: "#dbeafe", color: "#1e40af", padding: 12, borderRadius: 8, fontSize: 14 }}>
              {t("A bank payment for this invoice is processing (3–5 business days) — nothing to pay right now.")}
            </p>
          )}

          {!loading && info && info.status !== "Paid" && info.status !== "Processing" && !isInvoicePayableNow(info.invoiceMonth) && (
            <p style={{ background: "#f3f4f6", color: "#374151", padding: 12, borderRadius: 8, fontSize: 14 }}>
              {t("Upcoming — the {month} invoice is available to pay on {date}.", { month: dateLabel(info.invoiceMonth), date: dateLabel(info.preparingUntil || invoicePayableFrom(info.invoiceMonth, undefined, info.invoiceGenerateDay || undefined)) })}
            </p>
          )}

          {!loading && info && info.status !== "Paid" && info.status !== "Processing" && isInvoicePayableNow(info.invoiceMonth) && info.preparingUntil && (
            <p style={{ background: "#f3f4f6", color: "#374151", padding: 12, borderRadius: 8, fontSize: 14 }}>
              {info.preparingMessage && info.preparingMessage.startsWith("Your electric reading")
                ? err(info.preparingMessage)
                : t("Being prepared — the {month} invoice is available to pay on {date}.", { month: dateLabel(info.invoiceMonth), date: dateLabel(info.preparingUntil) })}
            </p>
          )}

          {!loading && info && info.status !== "Paid" && info.status !== "Processing" && isInvoicePayableNow(info.invoiceMonth) && !info.preparingUntil && (
            <>
              {/* Oct 29 (review B1): next month's invoice — paying it now is optional. */}
              {isPayAheadInvoice({ invoice_month: info.invoiceMonth, due_date: info.dueDate, is_move_in: info.isMoveIn }) && (
                <p style={{ background: "#f0fdf4", color: "#166534", padding: 12, borderRadius: 8, fontSize: 14, marginBottom: 12 }}>
                  {t("This is next month's invoice (due {date}). Paying it now is optional — you are paying ahead.", { date: dateLabel(info.dueDate) })}
                </p>
              )}
              <p style={{ color: "#555", fontSize: 14, marginBottom: 20 }}>
                {t("You're paying an outstanding balance for a resident at {park}. For their privacy, this page only shows the amount due — not their name or full account.", { park: PARK_NAME })}
              </p>

              <div style={{ background: "#f9fafb", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                {info.lotName && (
                  <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                    <strong>{t("Lot:")}</strong> {info.lotName}
                  </p>
                )}
                <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                  <strong>{t("Invoice:")}</strong> {dateLabel(info.invoiceMonth)}
                </p>
                <p style={{ margin: "2px 0", fontSize: 14, color: "#111" }}>
                  <strong>{t("Due Date:")}</strong> {dateLabel(info.dueDate)}
                </p>
                <p style={{ margin: "10px 0 0", fontSize: 22, fontWeight: 800, color: "#000" }}>
                  {money(info.amountDue)}
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
                {paying ? t("Redirecting to payment...") : t("Pay {amount}", { amount: money(info.amountDue) })}
              </button>
            </>
          )}

          {!loading && info && info.status === "Paid" && (
            <p style={{ background: "#dcfce7", color: "#166534", padding: 12, borderRadius: 8, fontSize: 14 }}>
              {t("✅ This invoice has already been paid — nothing due.")}
            </p>
          )}
        </div>

        <p style={{ textAlign: "center", color: "#9ca3af", fontSize: 11, marginTop: 16 }}>
          {t("Powered by MelyOS.io")}
        </p>
      </div>
    </main>
  );
}

function LoadingText() {
  const { t } = usePortalLang();
  return <>{t("Loading...")}</>;
}

export default function PayInvoicePage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <p style={{ color: "#555" }}><LoadingText /></p>
          </div>
        </main>
      }
    >
      <PayInvoiceContent />
    </Suspense>
  );
}
