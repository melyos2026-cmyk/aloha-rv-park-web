"use client";
import { portalConfirm, portalAlert } from "@/components/portalDialog";

import { useEffect, useState } from "react";
import { isInvoicePayableNow, invoicePayableFrom } from "@/lib/invoicePayable";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { portalBackHref } from "@/components/ResidentPortalNav";
import { usePortalLang } from "@/lib/portalI18n";

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
  const [generateDay, setGenerateDay] = useState<number | undefined>(undefined); // company invoice day (Oct 29)
  const [itemsByInvoice, setItemsByInvoice] = useState<Record<string, InvoiceItem[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Search by month name or year (Aug 3, per Mely's request) — invoice_month
  // is stored like "August 2026", so a plain substring match covers both.
  const [search, setSearch] = useState("");
  // Explicit inline-style hover state (Aug 3, per Mely) — Tailwind's
  // hover:/active: classes were too subtle/unreliable to notice, so this
  // drives the hover effect directly instead, guaranteed to show.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { lang, t, st, money, date, dateLabel, err } = usePortalLang();

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage(t("Please log in again."));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/portal/invoices?residentId=${residentId}`);
      const result = await res.json();
      if (!res.ok) {
        setMessage(t("Could not load invoices: {detail}", { detail: err(result?.error) || res.status }));
        setLoading(false);
        return;
      }
      setInvoices(result.invoices || []);
      if (Number(result.invoiceGenerateDay) > 0) setGenerateDay(Number(result.invoiceGenerateDay));
    } catch (e: any) {
      setMessage(t("Could not load invoices (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
        void portalAlert(t("Could not download invoice: {detail}", { detail: err(result?.error) || res.status }));
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
    } catch (e: any) {
      void portalAlert(t("Could not download invoice (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
    setDownloadingId(null);
  }

  function formatMoney(value: number | null) {
    return money(Number(value || 0));
  }

  function formatDate(value: string | null) {
    if (!value) return t("No due date");
    return date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value), { year: "numeric", month: "short", day: "numeric" });
  }

  function statusColor(status: string | null) {
    const s = (status || "").toLowerCase();
    if (s === "paid") return { bg: "#dcfce7", text: "#166534" };
    if (s === "pending") return { bg: "#fef9c3", text: "#854d0e" };
    // Oct 28: a bank (ACH) payment still clearing — nothing to pay meanwhile.
    if (s === "processing") return { bg: "#dbeafe", text: "#1e40af" };
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
      // Also matches the month in the resident's language ("agosto" finds "August 2026").
      const q = search.trim().toLowerCase();
      return month.includes(q) || (lang !== "en" && dateLabel(inv.invoice_month || "").toLowerCase().includes(q));
    }
    return month.includes(currentYear);
  });

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", padding: 24, backgroundColor: "#f5f6f8" }}>
        <div style={{ maxWidth: 576, margin: "0 auto", borderRadius: 12, background: "#fff", padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
          <p style={{ color: "#000" }}>{t("Loading invoices...")}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      <div style={{ maxWidth: 576, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => (window.location.href = portalBackHref("pay"))}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
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
        <div style={{ borderRadius: 12, background: "#fff", padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>{t("Invoices")}</h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
            {t("View your monthly invoices and charge breakdown, or download a printable PDF.")}
          </p>
          {lang !== "en" && <p style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>{t("Invoice PDFs are in English.")}</p>}
        </div>

        {message && (
          <div style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e", border: "1px solid #fde68a" }}>
            {message}
          </div>
        )}

        {/* Search */}
        <div style={{ borderRadius: 12, background: "#fff", padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#000", display: "block", marginBottom: 10 }}>
            {t("Search by month or year")}
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("e.g. August, or 2026")}
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
              {t("Showing invoices for {year}. Search above to find invoices from a different month or year.", { year: currentYear })}
            </p>
          )}
        </div>

        {/* Invoices — spacious cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredInvoices.length === 0 ? (
            <div style={{ borderRadius: 12, background: "#fff", padding: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb" }}>
              <p className="text-black">
                {invoices.length === 0
                  ? t("No invoices found yet.")
                  : isSearching
                  ? t("No invoices match your search.")
                  : t("No invoices for {year} yet.", { year: currentYear })}
              </p>
            </div>
          ) : (
            filteredInvoices.map((invoice) => {
              const colors = statusColor(invoice.status);
              const isOpen = expanded === invoice.id;
              const isHovered = hoveredId === invoice.id;
              return (
                <div
                  key={invoice.id}
                  onMouseEnter={() => setHoveredId(invoice.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    borderRadius: 12,
                    background: "#fff",
                    overflow: "hidden",
                    border: isHovered ? "1.5px solid #9ca3af" : "1px solid #e5e7eb",
                    boxShadow: isHovered
                      ? "0 6px 16px rgba(0,0,0,0.12)"
                      : "0 1px 3px rgba(0,0,0,0.08)",
                    transform: isHovered ? "translateY(-2px)" : "translateY(0)",
                    transition: "all 0.15s ease",
                  }}
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
                      background: isHovered ? "#f3f4f6" : "none",
                      border: "none",
                      cursor: "pointer",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <div>
                      <p style={{ fontSize: 20, fontWeight: 800, color: "#000", marginBottom: 10 }}>
                        {invoice.invoice_month ? dateLabel(invoice.invoice_month) : t("Invoice")}
                      </p>
                      <p style={{ fontSize: 14, color: "#4b5563" }}>{t("Due: {date}", { date: formatDate(invoice.due_date) })}</p>
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
                        {invoice.status === "Processing"
                          ? t("Processing (bank)")
                          : (invoice.status || "Pending") === "Pending" && (invoice as any).preparing_reason === "electric"
                          ? err((invoice as any).preparing_message)
                          : (invoice.status || "Pending") === "Pending" && (invoice as any).preparing_until
                          ? t("Being prepared — available {date}", { date: dateLabel((invoice as any).preparing_until) })
                          : (invoice.status || "Pending") === "Pending" && !isInvoicePayableNow(invoice.invoice_month)
                          ? t("Upcoming — available to pay on {date}", { date: dateLabel(invoicePayableFrom(invoice.invoice_month, undefined, generateDay)) })
                          : st(invoice.status || "Pending")}
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
                          <span>{t(item.description || item.charge_type || "Charge")}</span>
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
                        {downloadingId === invoice.id ? t("Preparing...") : t("⬇ Download PDF")}
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
