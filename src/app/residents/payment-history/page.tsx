"use client";

import { useEffect, useState } from "react";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { portalBackHref } from "@/components/ResidentPortalNav";
import { usePortalLang } from "@/lib/portalI18n";

type Payment = {
  id: string;
  amount: number | null;
  total_due: number | null;
  due_date: string | null;
  payment_date: string | null;
  payment_method: string | null;
  status: string | null;
  notes: string | null;
  charge_type: string | null;
  custom_charge: string | null;
};

type FilterMode = "days" | "month" | "year";

export default function PaymentHistoryPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  // Bank-statement-style filtering (Aug 3, per Mely's request #15):
  // quick day-range buttons, plus a specific month or year lookup.
  const [filterMode, setFilterMode] = useState<FilterMode>("days");
  const [days, setDays] = useState("30");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { t, money, date, err } = usePortalLang();

  useEffect(() => {
    loadPaymentHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, days, month, year]);

  async function loadPaymentHistory() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage(t("Please log in again."));
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ residentId });
    if (filterMode === "days") params.set("days", days);
    if (filterMode === "month") params.set("month", month);
    if (filterMode === "year") params.set("year", year);

    try {
      const res = await fetch(`/api/portal/payment-history?${params.toString()}`);
      const result = await res.json();
      if (!res.ok) {
        setMessage(t("Could not load payment history: {detail}", { detail: err(result?.error) || res.status }));
        setLoading(false);
        return;
      }
      setPayments(result.payments || []);
    } catch (e: any) {
      setMessage(t("Could not load payment history (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
    setLoading(false);
  }

  function formatMoney(value: number | null) {
    return money(Number(value || 0));
  }

  function formatDate(value: string | null) {
    if (!value) return t("No payment date");
    return date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function getChargeLabel(payment: Payment) {
    if (payment.charge_type === "Custom" && payment.custom_charge) {
      return payment.custom_charge;
    }
    return t(payment.charge_type || "Charge");
  }

  function periodLabel() {
    if (filterMode === "days") return t("Last {n} days", { n: days });
    if (filterMode === "month") {
      const [y, m] = month.split("-").map(Number);
      return date(new Date(y, m - 1, 1), { month: "long", year: "numeric" });
    }
    return year;
  }

  const totalPaid = payments.reduce((sum, payment) => {
    return sum + Number(payment.total_due || payment.amount || 0);
  }, 0);

  const cardStyle = {
    borderRadius: 12,
    background: "#fff",
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e5e7eb",
  };

  if (loading && payments.length === 0) {
    return (
      <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", ...cardStyle }}>
          <p style={{ color: "#000" }}>{t("Loading payment history...")}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      {/* Only what's inside #printable-area shows when printing — filters
          and the page chrome are hidden via the print stylesheet below. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          #printable-area { box-shadow: none !important; border: none !important; padding: 0 !important; }
        }
      `}</style>

      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => (window.location.href = portalBackHref("pay"))}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
          className="no-print"
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            padding: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "#6b7280",
            cursor: "pointer",
            transition: "color 0.15s ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t("Back")}
        </button>
        <PortalLangSwitcher compact />
        </div>
        <div className="no-print" style={cardStyle}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>{t("Payment History")}</h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
            {t("View a statement of your completed payments.")}
          </p>
        </div>

        {message && (
          <div className="no-print" style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e" }}>
            {message}
          </div>
        )}

        {/* Filters — hidden when printing */}
        <div className="no-print" style={cardStyle}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#000", marginBottom: 14 }}>{t("Show transactions from:")}</p>
          <select
            value={filterMode === "days" ? `days-${days}` : filterMode}
            onChange={(e) => {
              const value = e.target.value;
              if (value.startsWith("days-")) {
                setFilterMode("days");
                setDays(value.replace("days-", ""));
              } else {
                setFilterMode(value as FilterMode);
              }
            }}
            style={{
              border: "1.5px solid #d1d5db",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 15,
              color: "#000",
              background: "#fff",
              width: "100%",
              maxWidth: 260,
            }}
          >
            <option value="days-30">{t("Last {n} days", { n: 30 })}</option>
            <option value="days-60">{t("Last {n} days", { n: 60 })}</option>
            <option value="days-90">{t("Last {n} days", { n: 90 })}</option>
            <option value="days-180">{t("Last {n} days", { n: 180 })}</option>
            <option value="month">{t("Specific Month")}</option>
            <option value="year">{t("Specific Year")}</option>
          </select>

          {filterMode === "month" && (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 14px", marginTop: 14 }}
            />
          )}
          {filterMode === "year" && (
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 14px", marginTop: 14, width: 120 }}
            />
          )}
        </div>

        {/* Statement — this is what actually prints */}
        <div id="printable-area" style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{periodLabel()}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#000" }}>{t("Total for this period")}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#000" }}>{formatMoney(totalPaid)}</p>
              <button
                className="no-print"
                onClick={() => window.print()}
                style={{
                  background: "#000",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 18px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {t("🖨️ Print")}
              </button>
            </div>
          </div>
          <div style={{ borderBottom: "1.5px solid #e5e7eb", marginTop: 20, marginBottom: 20 }} />

          {payments.length === 0 ? (
            <p style={{ color: "#000" }}>{t("No payments found for this period.")}</p>
          ) : (
            <div>
              {/* Bank-statement-style table: date | description | method | amount */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 120px 100px",
                  gap: 12,
                  padding: "0 0 10px 0",
                  borderBottom: "1.5px solid #e5e7eb",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#6b7280",
                }}
              >
                <span>{t("DATE")}</span>
                <span>{t("DESCRIPTION")}</span>
                <span>{t("METHOD")}</span>
                <span style={{ textAlign: "right" }}>{t("AMOUNT")}</span>
              </div>
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 120px 100px",
                    gap: 12,
                    padding: "14px 0",
                    borderBottom: "1px solid #f3f4f6",
                    fontSize: 14,
                  }}
                >
                  <span style={{ color: "#000" }}>{formatDate(payment.payment_date)}</span>
                  <span style={{ color: "#000" }}>
                    {getChargeLabel(payment)}
                    {payment.notes && (
                      <span style={{ display: "block", fontSize: 12, color: "#6b7280" }}>{payment.notes}</span>
                    )}
                  </span>
                  <span style={{ color: "#6b7280" }}>
                    {/* Sep 18 (per Mely): never show the underlying payment
                        processor's name to the resident — "Stripe" is an
                        implementation detail, "Card" is what they actually
                        paid with. */}
                    {payment.payment_method === "Stripe" ? t("Card") : payment.payment_method ? t(payment.payment_method) : "—"}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 700, color: "#000" }}>
                    {formatMoney(Number(payment.total_due || payment.amount || 0))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
