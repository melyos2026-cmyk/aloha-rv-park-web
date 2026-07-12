"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type InvoiceItem = {
  id: string;
  charge_type: string | null;
  description: string | null;
  amount: number | null;
};

type Invoice = {
  id: string;
  invoice_month: string | null;
  due_date: string | null;
  status: string | null;
  total_amount: number | null;
  sent_at: string | null;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [itemsByInvoice, setItemsByInvoice] = useState<Record<string, InvoiceItem[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("resident_invoices")
      .select("*")
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("INVOICES ERROR:", error);
      setMessage("Could not load invoices.");
      setLoading(false);
      return;
    }

    setInvoices(data || []);
    setLoading(false);
  }

  async function toggleExpand(invoiceId: string) {
    if (expanded === invoiceId) {
      setExpanded(null);
      return;
    }

    setExpanded(invoiceId);

    if (!itemsByInvoice[invoiceId]) {
      const { data } = await supabase
        .from("resident_invoice_items")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: true });

      setItemsByInvoice((prev) => ({ ...prev, [invoiceId]: data || [] }));
    }
  }

  function formatMoney(value: number | null) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(value: string | null) {
    if (!value) return "No due date";
    return new Date(value).toLocaleDateString();
  }

  function statusColor(status: string | null) {
    const s = (status || "").toLowerCase();
    if (s === "paid") return { bg: "#dcfce7", text: "#166534" };
    if (s === "pending") return { bg: "#fef9c3", text: "#854d0e" };
    return { bg: "#f3f4f6", text: "#374151" };
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <p className="text-black">Loading invoices...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "#e1f8f7" }}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          <h1 className="text-2xl font-bold text-black">Invoices</h1>
          <p className="mt-1 text-sm text-black">
            View your monthly invoices and charge breakdown.
          </p>
        </div>

        {message && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
            {message}
          </div>
        )}

        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #16a34a" }}>
          {invoices.length === 0 ? (
            <p className="text-black">No invoices found yet.</p>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => {
                const colors = statusColor(invoice.status);
                const isOpen = expanded === invoice.id;
                return (
                  <div key={invoice.id} className="rounded-lg border p-4">
                    <button
                      onClick={() => toggleExpand(invoice.id)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <p className="font-semibold text-black">
                          {invoice.invoice_month || "Invoice"}
                        </p>
                        <p className="text-sm text-black">
                          Due: {formatDate(invoice.due_date)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-semibold"
                          style={{ backgroundColor: colors.bg, color: colors.text }}
                        >
                          {invoice.status || "Pending"}
                        </span>
                        <span className="text-lg font-bold text-black">
                          {formatMoney(invoice.total_amount)}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="mt-3 border-t pt-3">
                        {(itemsByInvoice[invoice.id] || []).length === 0 ? (
                          <p className="text-sm text-gray-500">Loading details...</p>
                        ) : (
                          <div className="space-y-2">
                            {(itemsByInvoice[invoice.id] || []).map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-black">
                                  {item.description || item.charge_type}
                                </span>
                                <span className="font-semibold text-black">
                                  {formatMoney(item.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
