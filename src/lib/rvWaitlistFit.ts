// Oct 28 (per Mely): "does this RV fit ANY lot of the park?" for the public waitlist.
// Pure functions — used by the API (src/app/api/rv-waitlist) and by the form (instant feedback).
//
// Lot limits come from what the office saved on each rentable lot (rv_lots.max_length_ft,
// max_driver_slide_outs, max_passenger_slide_outs). Slide-out limits are text: "0".."3", "4+", "Any".
//   - empty / not set           → not set on that lot
//   - "Any" or "N+"             → no limit on that lot
// A dimension that no lot has set never blocks anyone. When only SOME lots have it set, a lot
// without a value is assumed to take no more than the park's largest saved value (so a lot the
// office hasn't measured never lets a too-big RV through). Lots with nothing saved are ignored.
// An RV fits when at least ONE lot takes its length AND both slide-out counts at the same time.

/** One lot's effective limits: [length ft, driver-side, passenger-side]; null = no limit. */
export type LotLimit = [number | null, number | null, number | null];
export type ParkLimits = {
  /** distinct per-lot combinations (no lot names or ids) */
  lots: LotLimit[];
  /** the park's largest value per dimension; null = no limit / not set on any lot */
  maxLength: number | null;
  maxDriver: number | null;
  maxPassenger: number | null;
};
export type RvSize = { length: number; driver: number; passenger: number };

type RawLot = { max_length_ft?: unknown; max_driver_slide_outs?: unknown; max_passenger_slide_outs?: unknown };

// undefined = not set; Infinity = no limit; number = limit
function parseSlides(v: unknown): number | undefined {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  if (/^any$/i.test(s) || /\+$/.test(s)) return Infinity;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function parseLength(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parkLimitsFromLots(lots: RawLot[]): ParkLimits {
  // A lot with nothing saved at all is left out (it would otherwise count as the biggest lot of
  // every kind at once). If no lot has anything saved, `lots` is empty and nobody is blocked.
  const raw = lots
    .map((l) => [parseLength(l.max_length_ft), parseSlides(l.max_driver_slide_outs), parseSlides(l.max_passenger_slide_outs)] as (number | undefined)[])
    .filter((r) => r.some((x) => x !== undefined));
  const max = [0, 1, 2].map((d) => {
    const vals = raw.map((r) => r[d]).filter((x): x is number => x !== undefined);
    return vals.length ? Math.max(...vals) : Infinity; // not set anywhere → never blocks
  });
  const seen = new Set<string>();
  const out: LotLimit[] = [];
  for (const r of raw) {
    const eff = [0, 1, 2].map((d) => {
      const v = r[d] ?? max[d];
      return v === Infinity ? null : v;
    }) as LotLimit;
    const k = eff.join("|");
    if (!seen.has(k)) { seen.add(k); out.push(eff); }
  }
  const fin = (n: number) => (n === Infinity ? null : n);
  return { lots: out, maxLength: fin(max[0]), maxDriver: fin(max[1]), maxPassenger: fin(max[2]) };
}

export function rvFitsPark(limits: ParkLimits, rv: RvSize): boolean {
  if (!limits.lots.length) return true; // nothing saved — never block
  const ok = (lim: number | null, v: number) => lim === null || v <= lim;
  return limits.lots.some(([len, drv, pas]) => ok(len, rv.length) && ok(drv, rv.driver) && ok(pas, rv.passenger));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Friendly "your RV is too big" message with the park's real maximums. */
export function tooBigMessage(limits: ParkLimits, rv: RvSize): string {
  const parts: string[] = [];
  if (limits.maxLength !== null) parts.push(`RVs up to ${limits.maxLength} ft`);
  const slides: string[] = [];
  if (limits.maxDriver !== null) slides.push(`${limits.maxDriver} driver-side`);
  if (limits.maxPassenger !== null) slides.push(`${limits.maxPassenger} passenger-side`);
  if (slides.length) parts.push(`${parts.length ? "with " : "RVs with "}up to ${slides.join(" and ")} slide-outs`);
  const fitsEachMax =
    (limits.maxLength === null || rv.length <= limits.maxLength) &&
    (limits.maxDriver === null || rv.driver <= limits.maxDriver) &&
    (limits.maxPassenger === null || rv.passenger <= limits.maxPassenger);
  const ours = parts.length ? `our sites fit ${parts.join(" ")}.` : "";
  if (fitsEachMax) {
    return `Sorry — none of our sites fits a ${rv.length} ft RV with ${plural(rv.driver, "driver-side slide-out")} and ${plural(rv.passenger, "passenger-side slide-out")} at the same time${ours ? ` (${ours.slice(0, -1)})` : ""}. Please call the office if you have questions.`;
  }
  return `Sorry — ${ours} Your RV is larger than what we can host.`;
}
