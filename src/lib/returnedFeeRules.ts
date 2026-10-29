// Oct 28 (per Mely — owner-approved): the returned-bank-payment fee is a PER-COMPANY setting for every
// company (RV parks, campgrounds, marinas incl. government marinas). Pure functions, no imports — safe
// in the browser and on the server. The SAME file is copied in melyos-builder (lib/returnedFeeRules.ts);
// keep both in sync by hand.
//
//  - "florida" (default for private parks/marinas): $4.00 bank cost + a service charge as allowed by
//    Fla. Stat. 68.065 — $25 if the invoice amount is $50 or less, $30 up to $300, $31 above ($29/$34/$35).
//  - "custom" (government marinas whose fee schedule/ordinance sets it, e.g. Fla. Stat. 215.34 "$15 or
//    5%, whichever is greater"): max(flat, percent% × invoice amount), capped at `cap` when set. The
//    $4.00 bank cost is INSIDE this total; the total is never below $4.00.
//  - MelyOS share: "all" (default) = the whole fee goes to MelyOS; "fixed" = MelyOS gets
//    min(fee, shareAmount) (shareAmount is at least $4.00, so MelyOS's bank cost is always covered) and
//    the rest stays with the company.
// `percent` is a percentage number (5 = 5%).

export type ReturnedFeeMode = "florida" | "custom";
export type ReturnedShareMode = "all" | "fixed";
export type ReturnedFeeSettings = {
  mode: ReturnedFeeMode;
  flat: number;
  percent: number;
  cap: number | null;
  shareMode: ReturnedShareMode;
  shareAmount: number;
};

export const RETURNED_BANK_COST = 4.0;
export const FLORIDA_RETURNED_FEE: ReturnedFeeSettings = { mode: "florida", flat: 0, percent: 0, cap: null, shareMode: "all", shareAmount: RETURNED_BANK_COST };
// Used for marinas only when the settings columns don't exist yet (today's behavior there): flat $4.
export const FLAT_FOUR_RETURNED_FEE: ReturnedFeeSettings = { mode: "custom", flat: RETURNED_BANK_COST, percent: 0, cap: null, shareMode: "all", shareAmount: RETURNED_BANK_COST };

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const usd = (n: number) => (Number.isInteger(r2(n)) ? `$${r2(n)}` : `$${r2(n).toFixed(2)}`);
const usd2 = (n: number) => `$${r2(n).toFixed(2)}`;

// A database row (company_fee_settings) → settings. Unknown/invalid values fall back to Florida / all.
export function normalizeReturnedFeeSettings(row: Record<string, any> | null | undefined, fallback: ReturnedFeeSettings = FLORIDA_RETURNED_FEE): ReturnedFeeSettings {
  if (!row || row.returned_fee_mode == null) return fallback;
  const mode: ReturnedFeeMode = row.returned_fee_mode === "custom" ? "custom" : "florida";
  const flat = Math.max(0, r2(row.returned_fee_flat));
  const percent = Math.max(0, Math.min(100, Number(row.returned_fee_percent) || 0));
  const capRaw = row.returned_fee_cap;
  const cap = capRaw === null || capRaw === undefined || capRaw === "" ? null : Math.max(0, r2(capRaw));
  const shareMode: ReturnedShareMode = row.melyos_returned_share_mode === "fixed" ? "fixed" : "all";
  const shareAmount = Math.max(RETURNED_BANK_COST, r2(row.melyos_returned_share_amount ?? RETURNED_BANK_COST));
  return { mode, flat, percent, cap, shareMode, shareAmount };
}

// Checked when the admin saves. Returns an error message, or null when valid.
export function validateReturnedFeeSettings(s: { mode: string; flat?: unknown; percent?: unknown; cap?: unknown; shareMode?: string; shareAmount?: unknown }): string | null {
  if (s.mode !== "florida" && s.mode !== "custom") return "Choose Florida standard or Custom.";
  if (s.mode === "custom") {
    const flat = Number(s.flat);
    const percent = Number(s.percent || 0);
    if (!Number.isFinite(flat) || flat < RETURNED_BANK_COST) return `The flat amount must be at least ${usd2(RETURNED_BANK_COST)} (the bank's own charge is included in it).`;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return "The percent must be between 0 and 100.";
    if (s.cap !== null && s.cap !== undefined && s.cap !== "") {
      const cap = Number(s.cap);
      if (!Number.isFinite(cap) || cap < RETURNED_BANK_COST) return `The maximum must be at least ${usd2(RETURNED_BANK_COST)}.`;
      if (cap < flat) return "The maximum can't be lower than the flat amount.";
    }
  }
  if (s.shareMode !== undefined && s.shareMode !== "all" && s.shareMode !== "fixed") return "Choose how the fee is shared with MelyOS.";
  if (s.shareMode === "fixed") {
    const a = Number(s.shareAmount);
    if (!Number.isFinite(a) || a < RETURNED_BANK_COST) return `MelyOS's share must be at least ${usd2(RETURNED_BANK_COST)} (it covers the bank's charge).`;
  }
  return null;
}

export function floridaServiceCharge(invoiceAmount: number): number {
  const a = r2(invoiceAmount);
  if (a <= 50) return 25;
  if (a <= 300) return 30;
  return 31;
}

// What MelyOS gets from a returned-fee line of `lineAmount` (never more than the line).
export function melyosShareOfReturnedFee(s: ReturnedFeeSettings, lineAmount: number): number {
  const amt = Math.max(0, r2(lineAmount));
  if (s.shareMode === "fixed") return Math.min(amt, Math.max(RETURNED_BANK_COST, r2(s.shareAmount)));
  return amt;
}

export function returnedPaymentFee(s: ReturnedFeeSettings, invoiceAmount: number, companyName?: string | null): {
  total: number; melyosShare: number; companyShare: number; bankFee: number; serviceCharge: number | null; description: string;
} {
  const amount = Math.max(0, r2(invoiceAmount));
  let total: number;
  let serviceCharge: number | null = null;
  let description: string;
  if (s.mode === "custom") {
    let t = Math.max(r2(s.flat), r2((s.percent / 100) * amount));
    if (s.cap !== null && s.cap !== undefined) t = Math.min(t, r2(s.cap));
    total = Math.max(RETURNED_BANK_COST, r2(t));
    // A plain flat $4.00 (the bank's own charge — older payments / marinas before their rule is set).
    const bankCostOnly = r2(s.flat) <= RETURNED_BANK_COST && !(s.percent > 0) && total === RETURNED_BANK_COST;
    description = bankCostOnly ? `Returned bank payment fee (${usd2(RETURNED_BANK_COST)} bank fee)` : `Returned payment fee per ${companyName || "the"} fee schedule`;
  } else {
    serviceCharge = floridaServiceCharge(amount);
    total = r2(RETURNED_BANK_COST + serviceCharge);
    description = `Bank returned payment ${usd2(amount)} (${usd2(RETURNED_BANK_COST)} bank fee + ${usd2(serviceCharge)} service charge, Fla. Stat. 68.065)`;
  }
  const melyosShare = melyosShareOfReturnedFee(s, total);
  return { total, melyosShare, companyShare: r2(total - melyosShare), bankFee: RETURNED_BANK_COST, serviceCharge, description };
}

// The rule in words, without "If your bank returns a payment," — e.g. "a returned-payment fee of
// $29–$35 applies ($4 bank fee plus a service charge allowed by Florida law)".
export function returnedFeePhrase(s: ReturnedFeeSettings): string {
  if (s.mode !== "custom") return "a returned-payment fee of $29–$35 applies ($4 bank fee plus a service charge allowed by Florida law)";
  const capText = s.cap !== null && s.cap !== undefined ? `, up to ${usd(s.cap)}` : "";
  if (s.percent > 0) return `a returned-payment fee of ${usd(Math.max(s.flat, RETURNED_BANK_COST))} or ${r2(s.percent)}% of the invoice amount, whichever is greater${capText}, applies`;
  return `a returned-payment fee of ${usd(Math.max(s.flat, RETURNED_BANK_COST))} applies`;
}
export function returnedFeeDisclosure(s: ReturnedFeeSettings): string {
  return `If your bank returns a payment, ${returnedFeePhrase(s)}.`;
}

// Oct 28 (review): the rule SHOWN to the payer, frozen per payment (Stripe metadata "returned_fee_rule")
// and per autopay authorization (returned_fee_rule jsonb). Compact, never MelyOS's share:
// {"m":"florida"} | {"m":"custom","f":15,"p":5,"c":null} | {"m":"none"} (no fee was disclosed).
export function encodeReturnedFeeRule(s: ReturnedFeeSettings | null): string {
  if (!s) return JSON.stringify({ m: "none" });
  if (s.mode !== "custom") return JSON.stringify({ m: "florida" });
  return JSON.stringify({ m: "custom", f: r2(s.flat), p: r2(s.percent), c: s.cap === null || s.cap === undefined ? null : r2(s.cap) });
}
// undefined = nothing stored; null = "no fee"; otherwise the rule (share fields default to "all").
export function decodeReturnedFeeRule(v: unknown): ReturnedFeeSettings | null | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  let o: any = v;
  if (typeof v === "string") { try { o = JSON.parse(v); } catch { return undefined; } }
  if (!o || typeof o !== "object") return undefined;
  if (o.m === "none") return null;
  if (o.m === "florida") return { ...FLORIDA_RETURNED_FEE };
  if (o.m === "custom") {
    const flat = Math.max(0, r2(o.f)), percent = Math.max(0, Math.min(100, Number(o.p) || 0));
    const cap = o.c === null || o.c === undefined || o.c === "" ? null : Math.max(0, r2(o.c));
    return { mode: "custom", flat, percent, cap, shareMode: "all", shareAmount: RETURNED_BANK_COST };
  }
  return undefined;
}
