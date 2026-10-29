// Which invoice months a resident may pay now (America/New_York).
//
// Oct 29 (per Mely — owner decision): each month's invoice is created IN ADVANCE on the company's
// invoice generation day of the month before (Lease Defaults → invoice_generate_day, default 27;
// melyos-builder lib/monthlyInvoices.ts). Residents may pay that NEXT-month invoice from the day it
// is created. So the month window is: the current month or earlier, plus NEXT month. Two or more
// months ahead is never payable. Within that window the server-side check in invoiceRentReady.ts
// (every checkout, guest link and autopay path uses it) also blocks next month's invoice before the
// generation day and any invoice still waiting for its rent ("being prepared").
// Oct 28 (review, kept): an invoice whose rent is added later must never be paid first, or that rent
// would land on an already-paid invoice and never be collected.
// invoice_month is a label like "December 2026" (sometimes with a suffix such as
// "August 2026 — Deposit Deduction"); if it can't be read, it is treated as payable (old behavior).
// Safe for both server and browser (no imports).

export const DEFAULT_INVOICE_GENERATE_DAY = 27;

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
  return inv.year * 12 + inv.month <= cur.year * 12 + cur.month + 1; // Oct 29: next month too
}

/** Invoice month offset from the current month (0 = this month, 1 = next month, -1 = last month), or null. */
export function invoiceMonthOffset(invoiceMonth: string | null | undefined, now: Date = new Date()): number | null {
  const inv = parseInvoiceMonth(invoiceMonth);
  if (!inv) return null;
  const cur = currentMonthNewYork(now);
  return inv.year * 12 + inv.month - (cur.year * 12 + cur.month);
}

/** The company's invoice generation day from its Lease Defaults (15–28, default 27). */
export function invoiceGenerateDay(leaseDefaults: Record<string, any> | null | undefined): number {
  const raw = Math.floor(Number(leaseDefaults?.invoice_generate_day));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INVOICE_GENERATE_DAY;
  return Math.min(Math.max(raw, 15), 28);
}

// "November 27, 2026" — the earliest day an invoice two or more months ahead can be paid: the
// generation day of the month before it (null if it is in the payable window already).
export function invoicePayableFrom(invoiceMonth: string | null | undefined, now: Date = new Date(), generateDay: number = DEFAULT_INVOICE_GENERATE_DAY): string | null {
  if (isInvoicePayableNow(invoiceMonth, now)) return null;
  const inv = parseInvoiceMonth(invoiceMonth)!;
  const prevKey = inv.year * 12 + inv.month - 1;
  const y = Math.floor(prevKey / 12);
  const m = prevKey % 12;
  const name = MONTHS[m].charAt(0).toUpperCase() + MONTHS[m].slice(1);
  return `${name} ${generateDay}, ${y}`;
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

/** Today's day of the month in America/New_York. */
export function todayDayNewYork(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "numeric" }).format(now));
}

/** "October 30, 2026" — tomorrow in America/New_York (the next daily invoice run). */
export function tomorrowLabelNewYork(now: Date = new Date()): string {
  const iso = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  const name = MONTHS[t.getUTCMonth()].charAt(0).toUpperCase() + MONTHS[t.getUTCMonth()].slice(1);
  return `${name} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

// Oct 29 (review B1 — paying ahead is OPTIONAL): next month's invoice that is not due yet is a
// separate "Pay ahead" choice. Pay Now / Outstanding only ever covers what is owed now: this month,
// past months, and anything whose due date has arrived. (Autopay is separate: due_date <= today.)
// `is_move_in` (set by the server — src/lib/invoiceRentReady.ts moveInInvoiceIds) = the resident's
// move-in invoice: owed now, always part of Pay Now, never "Pay ahead".
export function isPayAheadInvoice(inv: { invoice_month?: string | null; due_date?: string | null; is_move_in?: boolean | null }, now: Date = new Date()): boolean {
  if (inv.is_move_in) return false;
  if (invoiceMonthOffset(inv.invoice_month, now) !== 1) return false;
  const todayIso = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return !inv.due_date || String(inv.due_date).slice(0, 10) > todayIso;
}
