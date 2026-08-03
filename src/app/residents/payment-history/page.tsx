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

  const totalPaid = payments.reduce((sum, payment) => {
    return sum + Number(payment.total_due || payment.amount || 0);
  }, 0);

  const filterButtonStyle = (active: boolean) => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "1.5px solid #000",
    background: active ? "#000" : "transparent",
    color: active ? "#fff" : "#000",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  });

  if (loading && payments.length === 0) {
    return (
      <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <p className="text-black">Loading payment history...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <h1 className="text-2xl font-bold text-black">Payment History</h1>
          <p className="mt-1 text-sm text-black">
            A statement of your completed payments — like a bank statement for your account.
          </p>
        </div>

        {message && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
            {message}
          </div>
        )}

        {/* Filters */}
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <p className="text-sm font-semibold text-black mb-2">Show transactions from:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
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
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                  style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: "6px 10px" }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                  style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: "6px 10px", width: 90 }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Statement */}
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <div className="flex items-center justify-between border-b pb-4">
            <p className="text-lg font-semibold text-black">Total for this period</p>
            <p className="text-2xl font-bold text-black">{formatMoney(totalPaid)}</p>
          </div>

          {payments.length === 0 ? (
            <p className="mt-4 text-black">No payments found for this period.</p>
          ) : (
            <div className="mt-2">
              {/* Bank-statement-style table: date | description | method | amount */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr 120px 100px",
                  gap: 8,
                  padding: "8px 4px",
                  borderBottom: "1.5px solid var(--border)",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--gray)",
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
                    gap: 8,
                    padding: "10px 4px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 14,
                  }}
                >
                  <span>{formatDate(payment.payment_date)}</span>
                  <span>
                    {getChargeLabel(payment)}
                    {payment.notes && (
                      <span style={{ display: "block", fontSize: 12, color: "var(--gray)" }}>{payment.notes}</span>
                    )}
                  </span>
                  <span style={{ color: "var(--gray)" }}>{payment.payment_method || "—"}</span>
                  <span style={{ textAlign: "right", fontWeight: 700 }}>
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
