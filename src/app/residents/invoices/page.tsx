"use client";

import { useEffect, useState } from "react";

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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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

    // SECURITY (Aug 3, item #17): moved from a direct client-side Supabase
    // read (anon key, bare localStorage resident_id, no session check) to
    // a session-guarded server route — same gap found/fixed in
    // payment-history.
    try {
      const res = await fetch(`/api/portal/invoices?residentId=${residentId}`);
      const result = await res.json();
      if (!res.ok) {
        setMessage("Could not load invoices: " + (result?.error || res.status));
        setLoading(false);
        return;
      }
      setInvoices(result.invoices || []);
    } catch (err: any) {
      setMessage("Could not load invoices (unexpected error): " + (err?.message || err));
    }
    setLoading(false);
  }

  async function toggleExpand(invoiceId: string) {
    if (expanded === invoiceId) {
      setExpanded(null);
      return;
    }

    setExpanded(invoiceId);

    if (!itemsByInvoice[invoiceId]) {
      const residentId = localStorage.getItem("resident_id");
      const res = await fetch(`/api/portal/invoice-items?invoiceId=${invoiceId}&residentId=${residentId}`);
      const result = await res.json();
      setItemsByInvoice((prev) => ({ ...prev, [invoiceId]: result.items || [] }));
    }
  }

  async function downloadInvoicePdf(invoiceId: string) {
    const residentId = localStorage.getItem("resident_id");
    setDownloadingId(invoiceId);
    try {
      const res = await fetch(`/api/portal/invoice-pdf?invoiceId=${invoiceId}&residentId=${residentId}`);
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        alert("Could not download invoice: " + (result?.error || res.status));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "invoice.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert("Could not download invoice (unexpected error): " + (err?.message || err));
    }
    setDownloadingId(null);
  }

  function formatMoney(value: number | null) {
    const n = Number(value || 0);
    return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
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
            View your monthly invoices and charge breakdown, or download a printable PDF.
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
                        <span className="font-bold text-black">
                          {formatMoney(invoice.total_amount)}
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="mt-3 border-t pt-3">
                        {(itemsByInvoice[invoice.id] || []).map((item) => (
                          <div key={item.id} className="flex justify-between py-1 text-sm text-black">
                            <span>{item.description || item.charge_type || "Charge"}</span>
                            <span style={{ color: Number(item.amount || 0) < 0 ? "#16a34a" : undefined }}>
                              {formatMoney(item.amount)}
                            </span>
                          </div>
                        ))}
                        <button
                          onClick={() => downloadInvoicePdf(invoice.id)}
                          disabled={downloadingId === invoice.id}
                          style={{
                            marginTop: 12,
                            background: "#000",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "8px 16px",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: downloadingId === invoice.id ? "default" : "pointer",
                            opacity: downloadingId === invoice.id ? 0.7 : 1,
                          }}
                        >
                          {downloadingId === invoice.id ? "Preparing..." : "⬇ Download PDF"}
                        </button>
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
