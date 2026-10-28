import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isCurrentInvoiceMonth, currentMonthDayLabel } from "@/lib/invoicePayable";

// Oct 28 (review): this month's invoice can exist before rent is on it — Electric Meter Readings
// creates an electric-only invoice early, and the generate-invoices cron (melyos-builder, daily
// 09:00 UTC) adds rent on the resident's due day. Paying it before then would leave rent off a
// paid invoice. So a CURRENT-month Pending invoice with no rent line (charge_type "Rent", the way
// the cron and prorated invoices add it) is "being prepared" — not payable yet — when the resident's
// billing profile has rent > 0 and the cron hasn't generated this month yet.
// Returns invoiceId → the day it becomes payable ("December 4, 2026"). If the profile or the items
// can't be read, returns an empty map (current behavior: payable).
export async function invoicesAwaitingRent(
  residentId: string | null | undefined,
  invoices: { id: string; invoice_month?: string | null; status?: string | null }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const candidates = invoices.filter((inv) => (inv.status || "Pending") === "Pending" && isCurrentInvoiceMonth(inv.invoice_month));
  if (!residentId || candidates.length === 0) return out;
  try {
    const { data: profile, error: profileErr } = await supabase
      .from("resident_billing_profiles")
      .select("rent_amount, due_day, use_seasonal_rent, high_season_rent, low_season_rent, last_invoice_generated")
      .eq("resident_id", residentId)
      .maybeSingle();
    if (profileErr || !profile) return out;
    const rent = Number(profile.rent_amount || 0);
    const seasonal = profile.use_seasonal_rent && (Number(profile.high_season_rent || 0) > 0 || Number(profile.low_season_rent || 0) > 0);
    if (!(rent > 0 || seasonal)) return out;

    const ids = candidates.map((c) => c.id);
    const { data: rentLines, error: itemsErr } = await supabase
      .from("resident_invoice_items")
      .select("invoice_id")
      .in("invoice_id", ids)
      .eq("charge_type", "Rent");
    if (itemsErr) return out;
    const withRent = new Set((rentLines || []).map((r) => r.invoice_id));
    const availableOn = currentMonthDayLabel(Number(profile.due_day || 1));
    for (const c of candidates) {
      // If the cron already ran for this month (e.g. rent was removed by hand), don't block it.
      if (profile.last_invoice_generated && profile.last_invoice_generated === c.invoice_month) continue;
      if (!withRent.has(c.id)) out.set(c.id, availableOn);
    }
  } catch {
    return new Map();
  }
  return out;
}
