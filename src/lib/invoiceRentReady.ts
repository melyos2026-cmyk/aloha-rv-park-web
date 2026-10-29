import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  currentMonthDayLabel,
  invoiceGenerateDay,
  invoiceMonthOffset,
  invoicePayableFrom,
  todayDayNewYork,
  tomorrowLabelNewYork,
} from "@/lib/invoicePayable";

// "Being prepared" — Pending invoices that exist but must NOT be paid yet. Every payment path uses
// this (Pay Now card/bank, guest pay link, card + bank autopay) and the portal shows the returned day
// instead of a Pay button.
//
// Oct 28 (review): an invoice can exist before rent is on it — Electric Meter Readings creates an
// electric-only invoice early, and the generate-invoices cron (melyos-builder, daily 09:00 UTC) adds
// the rent. Paying it before then would leave rent off a paid invoice.
// Oct 29 (per Mely — invoices are created on the company's invoice generation day of the month
// before, default the 27th; residents may pay NEXT month's invoice from that day):
//  - next month's invoice: not payable before this month's generation day (e.g. a December invoice
//    on Nov 10 → "November 27"), and from then on only once its rent is on it;
//  - Oct 29 (owner decision): for a METERED resident whose electric is charged on next month's
//    invoice (Lease Defaults electric_charge_next_month, from electric_charge_start_month on), next
//    month's invoice is also not payable in advance until its electric reading is saved on it — so
//    the electric charge is never left off a paid invoice. If no reading is saved by the due date, it
//    becomes payable on the due date (and autopay charges then), as before;
//  - this month's invoice: payable once its rent is on it (normally it already is — it was created
//    last month); if not, the next daily run adds it ("tomorrow");
//  - an invoice two or more months ahead: never (isInvoicePayableNow already blocks it; the day is
//    returned so the portal can say when).
// "Rent is on it" = a charge_type "Rent" line (the way the cron and prorated invoices add it), or the
// resident has no rent, or the cron already generated that month (last_invoice_generated is that
// month or later — e.g. rent removed by hand on purpose).
// "Electric is on it" = a saved (non-starting) electric reading linked to the invoice, or an
// "Electric" line (a reading under the included kWh adds no line but still counts).
// If the profile or the items can't be read, the rent/electric checks are skipped (old behavior:
// payable); the date rules still apply.

export type PreparingReason = "date" | "rent" | "electric";
export type PreparingInfo = { until: string; reason: PreparingReason; message: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function monthKey(label: string | null | undefined): number | null {
  const m = String(label || "").trim().match(/^([A-Za-z]+)\s+(\d{4})\b/);
  if (!m) return null;
  const i = MONTHS.indexOf(m[1].toLowerCase());
  return i < 0 ? null : Number(m[2]) * 12 + i;
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
function dateLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const name = MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1);
  return `${name} ${d}, ${y}`;
}

/**
 * Oct 29 (review): the resident's MOVE-IN invoice (billed at approval) — it is owed now, so it is never
 * "Pay ahead" and never waits for the generation day or an electric reading, even when the move-in
 * month is next month (e.g. approved Oct 28, moving in Nov 3 → the November invoice is due Nov 3).
 * Marker (most robust available without a schema change) — BOTH must hold:
 *   1) the invoice month is the start month of the resident's FIRST lease (earliest lease_start in
 *      resident_leases, not Cancelled — the approval creates that row with the application's
 *      lease_start; renewals / lot changes are later rows and never count), AND
 *   2) it carries the Rent line the approval writes (createProratedInvoice: "Prorated rent — …" or
 *      "Rent — 1 month") OR it has no "Monthly Rent" line (the monthly cron's).
 * Only invoices for the current or next month are checked.
 */
export async function moveInInvoiceIds(
  residentId: string | null | undefined,
  invoices: { id: string; invoice_month?: string | null }[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const cands = invoices.filter((i) => { const o = invoiceMonthOffset(i.invoice_month); return o === 0 || o === 1; });
  if (!residentId || cands.length === 0) return out;
  try {
    const [{ data: leases, error: leasesErr }, { data: lines, error: linesErr }] = await Promise.all([
      supabase.from("resident_leases").select("lease_start, status, created_at").eq("resident_id", residentId),
      supabase.from("resident_invoice_items").select("invoice_id, description").in("invoice_id", cands.map((c) => c.id)).eq("charge_type", "Rent"),
    ]);
    if (leasesErr || linesErr) return out; // can't tell → not marked
    // Oct 29 (final review): ONLY the resident's FIRST lease counts (earliest lease_start, not
    // cancelled) — renewals and lot changes never make a regular invoice a "move-in" one.
    let firstKey: number | null = null;
    let firstStart: string | null = null;
    for (const l of leases || []) {
      if (String((l as any).status || "").toLowerCase() === "cancelled" || !(l as any).lease_start) continue;
      const start = String((l as any).lease_start).slice(0, 10);
      if (firstStart === null || start < firstStart) firstStart = start;
    }
    if (firstStart) {
      const [y, m] = firstStart.split("-").map(Number);
      if (y && m) firstKey = y * 12 + (m - 1);
    }
    if (firstKey === null) return out;
    const approvalRent = new Set(
      (lines || [])
        .filter((r: any) => /^Prorated rent\b/i.test(String(r.description || "")) || String(r.description || "").trim() === "Rent — 1 month")
        .map((r: any) => r.invoice_id)
    );
    const cronRent = new Set((lines || []).filter((r: any) => String(r.description || "").trim() === "Monthly Rent").map((r: any) => r.invoice_id));
    // BOTH required: the invoice is for the first lease's start month AND (it carries the approval's
    // rent line OR it is not a regular cron invoice). Never marked on the line description alone
    // (the old approval flow's second, next-month invoice also says "Rent — 1 month").
    for (const c of cands) {
      const k = monthKey(c.invoice_month);
      if (k !== null && k === firstKey && (approvalRent.has(c.id) || !cronRent.has(c.id))) out.add(c.id);
    }
  } catch {
    // can't tell → not marked (the normal rules apply)
  }
  return out;
}

export async function invoicesPreparing(
  residentId: string | null | undefined,
  invoices: { id: string; invoice_month?: string | null; status?: string | null }[]
): Promise<Map<string, PreparingInfo>> {
  const out = new Map<string, PreparingInfo>();
  const candidates = invoices.filter((inv) => {
    if ((inv.status || "Pending") !== "Pending") return false;
    const off = invoiceMonthOffset(inv.invoice_month);
    return off !== null && off >= 0;
  });
  if (!residentId || candidates.length === 0) return out;
  try {
    const { data: profileRow, error: profileErr } = await supabase
      .from("resident_billing_profiles")
      .select("company_id, rent_amount, due_day, use_seasonal_rent, high_season_rent, low_season_rent, last_invoice_generated, electric_type")
      .eq("resident_id", residentId)
      .maybeSingle();
    // Can't read the profile → the rent/electric checks are skipped (old behavior), the date rules still apply.
    const profile = profileErr ? null : profileRow;

    // The company's generation day (default 27 when it can't be read) and electric rule.
    let leaseDefaults: Record<string, any> | null = null;
    if (profile?.company_id) {
      const { data: ps } = await supabase.from("park_settings").select("lease_defaults").eq("company_id", profile.company_id).maybeSingle();
      leaseDefaults = ((ps as any)?.lease_defaults as Record<string, any>) || null;
    }
    const generateDay = invoiceGenerateDay(leaseDefaults);
    const today = todayDayNewYork();
    const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const generationDayLabel = currentMonthDayLabel(generateDay);
    const dateMsg = (until: string) => `Available to pay on ${until}.`;

    const rent = Number(profile?.rent_amount || 0);
    const seasonal = !!profile?.use_seasonal_rent && (Number(profile?.high_season_rent || 0) > 0 || Number(profile?.low_season_rent || 0) > 0);
    const needsRent = !!profile && (rent > 0 || seasonal);
    const lastKey = monthKey(profile?.last_invoice_generated);
    const metered = profile?.electric_type === "metered" || profile?.electric_type === "metered_included";
    const electricNextMonth = leaseDefaults?.electric_charge_next_month === true;
    const electricStartKey = monthKey(typeof leaseDefaults?.electric_charge_start_month === "string" ? leaseDefaults.electric_charge_start_month : null);

    const rentCheck: typeof candidates = [];
    const electricCheck: typeof candidates = [];
    const moveIn = await moveInInvoiceIds(residentId, candidates);
    for (const c of candidates) {
      const off = invoiceMonthOffset(c.invoice_month)!;
      if (moveIn.has(c.id)) continue; // the move-in invoice is owed now — never held back
      if (off >= 2) {
        const until = invoicePayableFrom(c.invoice_month, undefined, generateDay) || generationDayLabel;
        out.set(c.id, { until, reason: "date", message: dateMsg(until) });
        continue;
      }
      if (off === 1 && today < generateDay) {
        out.set(c.id, { until: generationDayLabel, reason: "date", message: dateMsg(generationDayLabel) });
        continue;
      }
      const k = monthKey(c.invoice_month);
      if (needsRent && !(lastKey !== null && k !== null && lastKey >= k)) rentCheck.push(c);
      if (off === 1 && metered && electricNextMonth && (electricStartKey === null || (k !== null && k >= electricStartKey))) electricCheck.push(c);
    }

    if (rentCheck.length > 0) {
      const { data: rentLines, error: itemsErr } = await supabase
        .from("resident_invoice_items")
        .select("invoice_id")
        .in("invoice_id", rentCheck.map((c) => c.id))
        .eq("charge_type", "Rent");
      if (!itemsErr) {
        const withRent = new Set((rentLines || []).map((r) => r.invoice_id));
        // Oct 29 (review): the invoice run is daily at 09:00 UTC (4–5 AM in Florida). Before it has run
        // today (e.g. just after midnight on the generation day) the rent is added "later today".
        const nowUtc = new Date();
        const beforeTodaysRun = nowUtc.toISOString().slice(0, 10) === todayIso && nowUtc.getUTCHours() < 9;
        const todayLabel = dateLabel(todayIso);
        const until = beforeTodaysRun ? todayLabel : tomorrowLabelNewYork();
        const message = beforeTodaysRun ? "Being prepared — available to pay later today." : `Being prepared — available to pay on ${until}.`;
        for (const c of rentCheck) {
          if (!withRent.has(c.id)) out.set(c.id, { until, reason: "rent", message });
        }
      }
    }

    const electricPending = electricCheck.filter((c) => !out.has(c.id));
    if (electricPending.length > 0) {
      const ids = electricPending.map((c) => c.id);
      const [{ data: readings, error: rErr }, { data: elecLines, error: eErr }, { data: dueRows, error: dErr }] = await Promise.all([
        supabase.from("resident_electric_readings").select("invoice_id, is_baseline").in("invoice_id", ids),
        supabase.from("resident_invoice_items").select("invoice_id").in("invoice_id", ids).eq("charge_type", "Electric"),
        supabase.from("resident_invoices").select("id, due_date").in("id", ids),
      ]);
      if (!rErr && !eErr && !dErr) {
        const withElectric = new Set<string>([
          ...(readings || []).filter((r: any) => r.is_baseline !== true).map((r: any) => r.invoice_id),
          ...(elecLines || []).map((r: any) => r.invoice_id),
        ]);
        const dueById = new Map((dueRows || []).map((r: any) => [r.id, r.due_date ? String(r.due_date).slice(0, 10) : null]));
        const readingDay = ordinal(generateDay);
        for (const c of electricPending) {
          if (withElectric.has(c.id)) continue;
          const due = dueById.get(c.id);
          if (!due || due <= todayIso) continue; // due date reached without a reading → payable as before
          out.set(c.id, {
            until: dateLabel(due),
            reason: "electric",
            message: `Your electric reading is added around the ${readingDay} — you can pay as soon as it's on your invoice.`,
          });
        }
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** invoiceId → the day it becomes payable at the latest ("November 27, 2026"). */
export async function invoicesAwaitingRent(
  residentId: string | null | undefined,
  invoices: { id: string; invoice_month?: string | null; status?: string | null }[]
): Promise<Map<string, string>> {
  const details = await invoicesPreparing(residentId, invoices);
  return new Map(Array.from(details.entries()).map(([id, d]) => [id, d.until]));
}

/** The resident's company invoice generation day (Lease Defaults; 27 when it can't be read). */
export async function invoiceGenerateDayForResident(residentId: string | null | undefined): Promise<number> {
  if (!residentId) return invoiceGenerateDay(null);
  try {
    const { data: r } = await supabase.from("resident_accounts").select("company_id").eq("id", residentId).maybeSingle();
    if (!r?.company_id) return invoiceGenerateDay(null);
    const { data: ps } = await supabase.from("park_settings").select("lease_defaults").eq("company_id", r.company_id).maybeSingle();
    return invoiceGenerateDay((ps as any)?.lease_defaults);
  } catch {
    return invoiceGenerateDay(null);
  }
}
