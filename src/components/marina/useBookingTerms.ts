"use client";
import { useEffect, useState } from "react";

// Oct 26 (per Mely): how this marina takes online bookings (all now or a deposit) and whether the
// signed-in boater gets resident rates. Fetched once per page.
export type BookingTerms = { deposit_mode: "full" | "percent" | "first_night"; deposit_percent: number; balance_due: "arrival" | "days_before"; balance_days_before: number; resident: boolean;
  // Oct 27: short-stay rules and the long-term terms the marina offers
  rules?: { maxNights: number; maxDaysYear: number | null; dockageTerms: string; offered: Record<string, boolean>; noticeDays: number; prepayPct: number } };
let cache: Promise<BookingTerms | null> | null = null;

export function useBookingTerms() {
  const [t, setT] = useState<BookingTerms | null>(null);
  useEffect(() => {
    cache ||= fetch("/api/marina/booking-terms").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    let live = true;
    cache.then((x) => { if (live) setT(x); });
    return () => { live = false; };
  }, []);
  return t;
}

export const unitPriceFor = (r: { resident?: number | null; non_resident?: number | null } | undefined, resident: boolean) =>
  r ? (resident ? r.resident ?? r.non_resident : r.non_resident ?? r.resident) ?? 0 : 0;

const PER_NIGHT: Record<string, number> = { transient_daily: 1, transient_weekly: 7, monthly: 30 };
const r2 = (n: number) => Math.round(n * 100) / 100;
const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// Same rule as the server (src/lib/marina/booking.ts → splitPayment).
export function splitFor(t: BookingTerms | null, total: number, unitPrice: number, stay: string, start: string) {
  const full = { payNow: r2(total), balance: 0, balanceDue: null as string | null };
  if (!t || t.deposit_mode === "full") return full;
  const deposit = t.deposit_mode === "percent" ? r2(total * (t.deposit_percent / 100)) : r2(unitPrice / (PER_NIGHT[stay] || 1));
  if (!(deposit > 0) || deposit >= total - 0.5) return full;
  let due = start;
  if (t.balance_due === "days_before") { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - t.balance_days_before); due = d.toISOString().slice(0, 10); }
  if (due <= localToday()) return full;
  return { payNow: deposit, balance: r2(total - deposit), balanceDue: due };
}
