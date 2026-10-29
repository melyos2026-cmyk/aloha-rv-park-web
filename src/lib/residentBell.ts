import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 29 (per Mely — resident bell for money events): ONE resident_facing row in the resident's own
// portal bell (+ phone push via the admin app's dispatch), only the first time for `onceKey`
// (e.g. the PaymentIntent). Marker in admin_notification_markers (scripts/notification_prefs.sql),
// key prefixed "resident_bell:". Before that SQL runs, the same message to the same resident in the
// last 7 days counts as "already told". Bell only — never email/SMS. Never throws; call it AFTER the
// money logic.

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(String(e.message || "")));

export const bellMoney = (n: number | string | null | undefined) => `$${(Math.round(Number(n || 0) * 100) / 100).toFixed(2)}`;

/** "October 2026" / "October 2026 and November 2026" / "your invoices" for the bell text. */
export function bellMonths(months: (string | null | undefined)[]): string {
  const list = [...new Set(months.map((m) => String(m || "").trim()).filter(Boolean))];
  if (list.length === 0) return "your invoice";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export async function notifyResidentBellOnce(p: {
  companyId: string | null | undefined;
  residentId: string | null | undefined;
  onceKey: string;
  updateType: string;
  message: string;
}): Promise<boolean> {
  try {
    if (!p.companyId || !p.residentId || !p.onceKey) return false;
    const key = `resident_bell:${p.onceKey}`;
    const { error: mErr } = await supabaseAdmin.from("admin_notification_markers").insert({ key, company_id: p.companyId });
    if (mErr) {
      if (mErr.code === "23505") return false; // already told
      if (!missingTable(mErr)) return false;   // unknown problem: don't risk a duplicate
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: seen, error: sErr } = await supabaseAdmin.from("resident_update_notifications").select("id")
        .eq("company_id", p.companyId).eq("resident_id", p.residentId).eq("resident_facing", true)
        .eq("update_type", p.updateType).eq("message", p.message).gte("created_at", since).limit(1);
      if (sErr || seen?.length) return false;
    }
    const { error } = await supabaseAdmin.from("resident_update_notifications").insert({
      company_id: p.companyId,
      resident_id: p.residentId,
      resident_name: null,
      update_type: p.updateType,
      message: p.message,
      resident_facing: true,
    });
    if (error) {
      if (!mErr) await supabaseAdmin.from("admin_notification_markers").delete().eq("key", key).then(() => null, () => null);
      console.error("notifyResidentBellOnce:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error("notifyResidentBellOnce:", e?.message || e);
    return false;
  }
}
