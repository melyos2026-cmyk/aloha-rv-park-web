// Oct 28 (review): an invoice for a FUTURE month (e.g. the electric-only "shell" invoice that
// Electric Meter Readings creates on the 27th for next month) is not payable yet. If it were paid
// early, the rent the invoice-generation cron adds on the 1st+ would land on an already-paid
// invoice and never be collected. Payable = invoice_month is the current month or earlier, in
// America/New_York. invoice_month is a label like "December 2026" (sometimes with a suffix such as
// "August 2026 — Deposit Deduction"); if it can't be read, it is treated as payable (old behavior).
// Safe for both server and browser (no imports).

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseInvoiceMonth(label: string | null | undefined): { year: number; month: number } | null {
  const m = String(label || "").trim().match(/^([A-Za-z]+)\s+(\d{4})\b/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const year = Number(m[2]);
  if (month < 0 || !Number.isFinite(year)) return null;
  return { year, month };
}

function currentMonthNewYork(now: Date = new Date()): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value) - 1;
  return { year, month };
}

export function isInvoicePayableNow(invoiceMonth: string | null | undefined, now: Date = new Date()): boolean {
  const inv = parseInvoiceMonth(invoiceMonth);
  if (!inv) return true;
  const cur = currentMonthNewYork(now);
  return inv.year * 12 + inv.month <= cur.year * 12 + cur.month;
}

// "December 1, 2026" — the day a future-month invoice becomes payable (null if not a future month).
export function invoicePayableFrom(invoiceMonth: string | null | undefined, now: Date = new Date()): string | null {
  if (isInvoicePayableNow(invoiceMonth, now)) return null;
  const inv = parseInvoiceMonth(invoiceMonth)!;
  const name = MONTHS[inv.month].charAt(0).toUpperCase() + MONTHS[inv.month].slice(1);
  return `${name} 1, ${inv.year}`;
}

// True when the label is exactly the current month (America/New_York).
export function isCurrentInvoiceMonth(invoiceMonth: string | null | undefined, now: Date = new Date()): boolean {
  const inv = parseInvoiceMonth(invoiceMonth);
  if (!inv) return false;
  const cur = currentMonthNewYork(now);
  return inv.year === cur.year && inv.month === cur.month;
}

// "December 4, 2026" for day `day` of the current month (America/New_York), clamped to the month's length.
export function currentMonthDayLabel(day: number, now: Date = new Date()): string {
  const cur = currentMonthNewYork(now);
  const last = new Date(Date.UTC(cur.year, cur.month + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(Math.floor(day) || 1, 1), last);
  const name = MONTHS[cur.month].charAt(0).toUpperCase() + MONTHS[cur.month].slice(1);
  return `${name} ${d}, ${cur.year}`;
}
