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
  // Search by month name or year (Aug 3, per Mely's request) — invoice_month
  // is stored like "August 2026", so a plain substring match covers both.
  const [search, setSearch] = useState("");

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
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function statusColor(status: string | null) {
    const s = (status || "").toLowerCase();
    if (s === "paid") return { bg: "#dcfce7", text: "#166534" };
    if (s === "pending") return { bg: "#fef9c3", text: "#854d0e" };
    return { bg: "#f3f4f6", text: "#374151" };
  }

  // Per Mely (Aug 3): the main screen should only show the CURRENT year's
  // invoices by default — once a year ends, its invoices stay accessible
  // but only by searching for that month/year, not shown up front. This is
  // computed from today's actual date, so it repeats correctly every year
  // with no code changes needed, all the way until the resident's account
  // eventually closes (they move out).
  const currentYear = String(new Date().getFullYear());
  const isSearching = search.trim().length > 0;
  const filteredInvoices = invoices.filter((inv) => {
    const month = (inv.invoice_month || "").toLowerCase();
    if (isSearching) {
      return month.includes(search.trim().toLowerCase());
    }
    return month.includes(currentYear);
  });

  if (loading) {
    return (
      <main className="min-h-screen p-6" style={{ backgroundColor: "#f5f6f8" }}>
        <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #e5e7eb" }}>
          <p className="text-black">Loading invoices...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "#f5f6f8" }}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="rounded-xl bg-white p-8 shadow" style={{ border: "1px solid #e5e7eb" }}>
          <h1 className="text-3xl font-bold text-black">Invoices</h1>
          <p className="mt-2 text-base text-black">
            View your monthly invoices and charge breakdown, or download a printable PDF.
          </p>
        </div>

        {message && (
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800">
            {message}
          </div>
        )}

        {/* Search */}
        <div className="rounded-xl bg-white p-6 shadow" style={{ border: "1px solid #e5e7eb" }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#000", display: "block", marginBottom: 8 }}>
            Search by month or year
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. August, or 2026"
            style={{
              width: "100%",
              border: "1.5px solid #d1d5db",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 15,
            }}
          />
          {!isSearching && (
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 10 }}>
              Showing invoices for {currentYear}. Search above to find invoices from a different month or year.
            </p>
          )}
        </div>

        {/* Invoices — spacious cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 28 }}>
          {filteredInvoices.length === 0 ? (
            <div className="rounded-xl bg-white p-8 shadow" style={{ border: "1px solid #e5e7eb" }}>
              <p className="text-black">
                {invoices.length === 0
                  ? "No invoices found yet."
                  : isSearching
                  ? "No invoices match your search."
                  : `No invoices for ${currentYear} yet.`}
              </p>
            </div>
          ) : (
            filteredInvoices.map((invoice) => {
              const colors = statusColor(invoice.status);
              const isOpen = expanded === invoice.id;
              return (
                <div
                  key={invoice.id}
                  className="rounded-xl bg-white shadow"
                  style={{ border: "1px solid #e5e7eb", overflow: "hidden" }}
                >
                  <button
                    onClick={() => toggleExpand(invoice.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      textAlign: "left",
                      padding: "24px 28px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 20, fontWeight: 800, color: "#000", marginBottom: 10 }}>
                        {invoice.invoice_month || "Invoice"}
                      </p>
                      <p style={{ fontSize: 14, color: "#4b5563" }}>Due: {formatDate(invoice.due_date)}</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "6px 16px",
                          fontSize: 13,
                          fontWeight: 700,
                          backgroundColor: colors.bg,
                          color: colors.text,
                        }}
                      >
                        {invoice.status || "Pending"}
                      </span>
                      <span style={{ fontSize: 22, fontWeight: 800, color: "#000" }}>
                        {formatMoney(invoice.total_amount)}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{ borderTop: "1px solid #e5e7eb", padding: "20px 28px" }}>
                      {(itemsByInvoice[invoice.id] || []).map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "10px 0",
                            fontSize: 15,
                            color: "#000",
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <span>{item.description || item.charge_type || "Charge"}</span>
                          <span style={{ fontWeight: 600, color: Number(item.amount || 0) < 0 ? "#16a34a" : "#000" }}>
                            {formatMoney(item.amount)}
                          </span>
                        </div>
                      ))}
                      <button
                        onClick={() => downloadInvoicePdf(invoice.id)}
                        disabled={downloadingId === invoice.id}
                        style={{
                          marginTop: 20,
                          background: "#000",
                          color: "#fff",
                          border: "none",
                          borderRadius: 8,
                          padding: "12px 24px",
                          fontSize: 14,
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
            })
          )}
        </div>
      </div>
    </main>
  );
}
