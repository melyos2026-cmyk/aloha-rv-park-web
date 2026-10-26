// Oct 26 (per Mely — "si cabe el bote"): does a boat fit a slip, and which free slips fit it best?
// The marina sets each slip's limits in Slips & Rates (length, max beam, max draft, shore power).
// The boater types their boat; this compares one against the other. The same logic lives in
// the admin (melyos-builder lib/marinaFit.ts) so the boater and the office see the same answer.

export type BoatDims = { length: number; beam?: number | null; draft?: number | null; power?: string | null };
export type SlipDims = { length_ft?: number | null; max_beam_ft?: number | null; max_draft_ft?: number | null; has_power?: boolean | null; power_amps?: string | null; slip_type?: string | null };
export type FitCheck = { key: "length" | "beam" | "draft" | "power"; label: string; ok: boolean; detail: string };

const r1 = (n: number) => Math.round(n * 10) / 10;
export const ampsOf = (t: string | null | undefined) =>
  [...String(t || "").matchAll(/(\d{2,3})\s*(?:a\b|amp)/gi)].map((m) => Number(m[1])).filter((n) => n >= 15 && n <= 400);
export const neededAmps = (p: string | null | undefined) => { const n = parseInt(String(p || ""), 10); return Number.isFinite(n) && n > 0 ? n : 0; };

export function fitCheck(slip: SlipDims, boat: BoatDims): { fits: boolean; checks: FitCheck[]; spareLength: number | null; powerExact: boolean } {
  const checks: FitCheck[] = [];
  const L = Number(slip.length_ft) || 0;
  if (L) checks.push({ key: "length", label: "Length", ok: boat.length <= L, detail: boat.length <= L ? `${r1(L - boat.length)} ft to spare (slip up to ${L} ft)` : `Your boat is ${r1(boat.length - L)} ft too long (slip up to ${L} ft)` });
  const B = Number(slip.max_beam_ft) || 0;
  if (B && boat.beam) checks.push({ key: "beam", label: "Beam (width)", ok: boat.beam <= B, detail: boat.beam <= B ? `${r1(B - boat.beam)} ft to spare (up to ${B} ft wide)` : `${r1(boat.beam - B)} ft too wide (up to ${B} ft)` });
  const D = Number(slip.max_draft_ft) || 0;
  if (D && boat.draft) checks.push({ key: "draft", label: "Draft (depth)", ok: boat.draft <= D, detail: boat.draft <= D ? `${r1(D - boat.draft)} ft of water to spare (${D} ft deep)` : `Not deep enough: needs ${boat.draft} ft, slip has ${D} ft` });
  const need = neededAmps(boat.power);
  let powerExact = !need;
  if (need) {
    const amps = ampsOf(slip.power_amps);
    if (!slip.has_power) checks.push({ key: "power", label: "Shore power", ok: false, detail: "This slip has no shore power" });
    else if (!amps.length) { powerExact = true; checks.push({ key: "power", label: "Shore power", ok: true, detail: "Shore power available (ask the office for the amperage)" }); }
    else if (amps.includes(need)) { powerExact = true; checks.push({ key: "power", label: "Shore power", ok: true, detail: `${need} amp available` }); }
    else if (Math.max(...amps) > need) checks.push({ key: "power", label: "Shore power", ok: true, detail: `${amps.join("/")} amp — works with an adapter` });
    else checks.push({ key: "power", label: "Shore power", ok: false, detail: `Needs ${need} amp; this slip has ${amps.join("/")} amp` });
  }
  return { fits: checks.every((c) => c.ok), checks, spareLength: L ? r1(L - boat.length) : null, powerExact };
}

// Best first: fits, then the right power, then the least wasted length (keeps big slips for big boats).
export function rankSlips<T extends SlipDims & { id: string }>(slips: T[], boat: BoatDims) {
  return slips
    .map((s) => ({ slip: s, ...fitCheck(s, boat) }))
    .filter((x) => x.fits)
    .sort((a, b) => Number(b.powerExact) - Number(a.powerExact) || (a.spareLength ?? 999) - (b.spareLength ?? 999));
}
