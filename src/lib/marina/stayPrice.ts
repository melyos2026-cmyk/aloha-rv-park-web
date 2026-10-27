// Oct 27 (per Mely — like real marinas, e.g. Clearwater): a short stay gets the best rate by
// itself: 7+ nights use the weekly rate, 28+ nights the monthly rate. Used by the booking window
// (to show the price) and by the server (to charge it) — the same function, so they always match.
export type StayKind = "transient_daily" | "transient_weekly" | "monthly";
export type UnitRates = { daily?: number | null; weekly?: number | null; monthly?: number | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function stayPrice(stay: StayKind, units: number, rates: UnitRates): { total: number; label: string } | null {
  const d = Number(rates.daily) > 0 ? Number(rates.daily) : null;
  const w = Number(rates.weekly) > 0 ? Number(rates.weekly) : null;
  const m = Number(rates.monthly) > 0 ? Number(rates.monthly) : null;
  if (stay === "monthly") return m ? { total: r2(m * units), label: `${units} month${units > 1 ? "s" : ""}` } : null;
  const nights = stay === "transient_weekly" ? units * 7 : units;
  const options: { total: number; label: string }[] = [];
  if (stay === "transient_weekly" && w) options.push({ total: w * units, label: `${units} week${units > 1 ? "s" : ""}` });
  if (d) options.push({ total: d * nights, label: `${nights} night${nights > 1 ? "s" : ""}` });
  if (w && nights >= 7) {
    const weeks = Math.floor(nights / 7), rest = nights % 7;
    if (!rest || d) options.push({ total: w * weeks + (d || 0) * rest, label: `${weeks} week${weeks > 1 ? "s" : ""}${rest ? ` + ${rest} night${rest > 1 ? "s" : ""}` : ""} (weekly rate)` });
    if (rest) options.push({ total: w * Math.ceil(nights / 7), label: `${Math.ceil(nights / 7)} weeks (weekly rate)` });
  }
  if (m && nights >= 28 && nights <= 31) options.push({ total: m, label: "1 month (monthly rate)" });
  if (!options.length) return null;
  const best = options.reduce((a, b) => (b.total < a.total - 0.001 ? b : a));
  return { total: r2(best.total), label: best.label };
}
