"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    loadPaymentHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, days, month, year]);

  async function loadPaymentHistory() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
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
        setMessage("Could not load payment history: " + (result?.error || res.status));
        setLoading(false);
        return;
      }
      setPayments(result.payments || []);
    } catch (err: any) {
      setMessage("Could not load payment history (unexpected error): " + (err?.message || err));
    }
    setLoading(false);
  }

  function formatMoney(value: number | null) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value: string | null) {
    if (!value) return "No payment date";
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function getChargeLabel(payment: Payment) {
    if (payment.charge_type === "Custom" && payment.custom_charge) {
      return payment.custom_charge;
    }
    return payment.charge_type || "Charge";
  }

  function periodLabel() {
    if (filterMode === "days") return `Last ${days} days`;
    if (filterMode === "month") {
      const [y, m] = month.split("-").map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return year;
  }

  const totalPaid = payments.reduce((sum, payment) => {
    return sum + Number(payment.total_due || payment.amount || 0);
  }, 0);

  const filterButtonStyle = (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: 8,
    border: "1.5px solid " + (active ? "#000" : "#d1d5db"),
    background: active ? "#000" : "#fff",
    color: active ? "#fff" : "#000",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  });

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
          <p style={{ color: "#000" }}>Loading payment history...</p>
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
        <div className="no-print" style={cardStyle}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>Payment History</h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
            A statement of your completed payments — like a bank statement for your account.
          </p>
        </div>

        {message && (
          <div className="no-print" style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e" }}>
            {message}
          </div>
        )}

        {/* Filters — hidden when printing */}
        <div className="no-print" style={cardStyle}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#000", marginBottom: 14 }}>Show transactions from:</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            {["30", "60", "90", "180"].map((d) => (
              <button
                key={d}
                onClick={() => {
                  setFilterMode("days");
                  setDays(d);
                }}
                style={filterButtonStyle(filterMode === "days" && days === d)}
              >
                Last {d} days
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={() => setFilterMode("month")}
                style={filterButtonStyle(filterMode === "month")}
              >
                Specific Month
              </button>
              {filterMode === "month" && (
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "8px 12px" }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={() => setFilterMode("year")}
                style={filterButtonStyle(filterMode === "year")}
              >
                Specific Year
              </button>
              {filterMode === "year" && (
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "8px 12px", width: 100 }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Statement — this is what actually prints */}
        <div id="printable-area" style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>{periodLabel()}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#000" }}>Total for this period</p>
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
                🖨️ Print
              </button>
            </div>
          </div>
          <div style={{ borderBottom: "1.5px solid #e5e7eb", marginTop: 20, marginBottom: 20 }} />

          {payments.length === 0 ? (
            <p style={{ color: "#000" }}>No payments found for this period.</p>
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
                <span>DATE</span>
                <span>DESCRIPTION</span>
                <span>METHOD</span>
                <span style={{ textAlign: "right" }}>AMOUNT</span>
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
                  <span style={{ color: "#6b7280" }}>{payment.payment_method || "—"}</span>
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
