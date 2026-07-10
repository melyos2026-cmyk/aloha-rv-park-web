"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Resident = {
  id: string;
  full_name: string | null;
  company_id: string | null;
};

type Payment = {
  id: string;
  resident_id: string;
  amount: number | null;
  payment_date: string | null;
  payment_method: string | null;
  status: string | null;
  notes: string | null;
  due_date: string | null;
  late_fee: number | null;
  inconvenience_fee: number | null;
  total_due: number | null;
  charge_type: string | null;
  custom_charge: string | null;
};

export default function PortalPaymentsPage() {
  const [resident, setResident] = useState<Resident | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [itemizedEnabled, setItemizedEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadPayments();
  }, []);

  async function loadPayments() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
      setLoading(false);
      return;
    }

    const { data: residentData, error: residentError } = await supabase
      .from("resident_accounts")
      .select("id, full_name, company_id")
      .eq("id", residentId)
      .single();

    if (residentError || !residentData) {
      setMessage("Resident account not found.");
      setLoading(false);
      return;
    }

    setResident(residentData);

    if (residentData.company_id) {
      const { data: settingsData } = await supabase
        .from("park_settings")
        .select("itemized_payments_enabled")
        .eq("company_id", residentData.company_id)
        .maybeSingle();

      if (settingsData && settingsData.itemized_payments_enabled === false) {
        setItemizedEnabled(false);
      }
    }

    const { data, error } = await supabase
      .from("resident_payments")
      .select("*")
      .eq("resident_id", residentData.id)
      .eq("status", "Pending")
      .order("due_date", { ascending: true });

    if (error) {
      console.error("PAYMENTS ERROR:", error);
      setMessage("Could not load payments.");
      setLoading(false);
      return;
    }

    const pendingPayments = data || [];
    setPayments(pendingPayments);
    setSelectedIds(pendingPayments.map((payment) => payment.id));
    setLoading(false);
  }

  function togglePayment(paymentId: string) {
    if (!itemizedEnabled) return;
    setSelectedIds((current) =>
      current.includes(paymentId)
        ? current.filter((id) => id !== paymentId)
        : [...current, paymentId]
    );
  }

  const selectedPayments = useMemo(() => {
    return payments.filter((payment) => selectedIds.includes(payment.id));
  }, [payments, selectedIds]);

  const totalSelected = useMemo(() => {
    return selectedPayments.reduce((sum, payment) => {
      return sum + Number(payment.total_due || payment.amount || 0);
    }, 0);
  }, [selectedPayments]);

  const totalAllPending = useMemo(() => {
    return payments.reduce((sum, payment) => {
      return sum + Number(payment.total_due || payment.amount || 0);
    }, 0);
  }, [payments]);

  function formatMoney(value: number | null) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value: string | null) {
    if (!value) return "No due date";
    return new Date(value).toLocaleDateString();
  }

  function getChargeLabel(payment: Payment) {
    if (payment.charge_type === "Custom" && payment.custom_charge) {
      return payment.custom_charge;
    }

    return payment.charge_type || "Charge";
  }

  function continueToPayment() {
    const idsToUse = itemizedEnabled ? selectedIds : payments.map((p) => p.id);

    if (idsToUse.length === 0) {
      setMessage("Please select at least one charge.");
      return;
    }

    const totalToUse = itemizedEnabled ? totalSelected : totalAllPending;

    localStorage.setItem("selected_payment_ids", JSON.stringify(idsToUse));
    localStorage.setItem("selected_payment_total", String(totalToUse));

    window.location.href = "/residents/payment-review";
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <p className="text-black">Loading payments...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <h1 className="text-2xl font-bold text-black">Payments</h1>
          <p className="mt-1 text-sm text-black">
            {resident?.full_name ? `Resident: ${resident.full_name}` : ""}
          </p>
        </div>

        {message && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
            {message}
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <h2 className="text-xl font-semibold text-black">
            Outstanding Charges
          </h2>

          {payments.length === 0 ? (
            <p className="mt-4 text-black">
              You do not have any pending charges.
            </p>
          ) : itemizedEnabled ? (
            <div className="mt-4 space-y-3">
              {payments.map((payment) => {
                const checked = selectedIds.includes(payment.id);
                const amount = Number(payment.total_due || payment.amount || 0);

                return (
                  <label
                    key={payment.id}
                    className="flex cursor-pointer items-center justify-between rounded-lg border p-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePayment(payment.id)}
                        className="mt-1 h-4 w-4"
                      />

                      <div>
                        <p className="font-semibold text-black">
                          {getChargeLabel(payment)}
                        </p>

                        <p className="text-sm text-black">
                          Due: {formatDate(payment.due_date)}
                        </p>

                        {payment.notes && (
                          <p className="mt-1 text-sm text-black">
                            {payment.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <p className="font-bold text-black">
                      {formatMoney(amount)}
                    </p>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="mt-4">
              <p className="text-black mb-4">
                Please pay your total outstanding balance below.
              </p>
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-black">Total Outstanding Balance</p>
                  <p className="font-bold text-black text-xl">{formatMoney(totalAllPending)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-black">
                {itemizedEnabled ? "Total Selected" : "Total Due"}
              </p>
              <p className="text-2xl font-bold text-black">
                {formatMoney(itemizedEnabled ? totalSelected : totalAllPending)}
              </p>
            </div>

            <button
              onClick={continueToPayment}
              disabled={payments.length === 0}
              className="mt-6 w-full rounded-lg px-4 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: "#d3f8e2", border: "1px solid #16a34a" }}
            >
              Continue To Payment
            </button>
          </div>
        </div>

        <button
          onClick={() => (window.location.href = "/residents/dashboard")}
          className="text-sm text-black hover:underline"
        >
          Back to Dashboard
        </button>
      </div>
    </main>
  );
}
