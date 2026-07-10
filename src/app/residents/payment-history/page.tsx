"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export default function PaymentHistoryPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadPaymentHistory();
  }, []);

  async function loadPaymentHistory() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("resident_payments")
      .select("*")
      .eq("resident_id", residentId)
      .eq("status", "Paid")
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("PAYMENT HISTORY ERROR:", error);
      setMessage("Could not load payment history.");
      setLoading(false);
      return;
    }

    setPayments(data || []);
    setLoading(false);
  }

  function formatMoney(value: number | null) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value: string | null) {
    if (!value) return "No payment date";
    return new Date(value).toLocaleDateString();
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

  if (loading) {
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
          <h1 className="text-2xl font-bold text-black">
            Payment History
          </h1>
          <p className="mt-1 text-sm text-black">
            View your completed payments.
          </p>
        </div>

        {message && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
            {message}
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <div className="flex items-center justify-between border-b pb-4">
            <p className="text-lg font-semibold text-black">
              Total Paid
            </p>
            <p className="text-2xl font-bold text-black">
              {formatMoney(totalPaid)}
            </p>
          </div>

          {payments.length === 0 ? (
            <p className="mt-4 text-black">
              No paid payments found yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="rounded-lg border p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-black">
                        {getChargeLabel(payment)}
                      </p>

                      <p className="text-sm text-black">
                        Paid: {formatDate(payment.payment_date)}
                      </p>

                      {payment.payment_method && (
                        <p className="text-sm text-black">
                          Method: {payment.payment_method}
                        </p>
                      )}

                      {payment.notes && (
                        <p className="mt-1 text-sm text-black">
                          {payment.notes}
                        </p>
                      )}
                    </div>

                    <p className="font-bold text-black">
                      {formatMoney(Number(payment.total_due || payment.amount || 0))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => (window.location.href = "/residents/payments")}
            className="text-sm text-black hover:underline"
          >
            Back to Payments
          </button>

          <button
            onClick={() => (window.location.href = "/residents/dashboard")}
            className="text-sm text-black hover:underline"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
