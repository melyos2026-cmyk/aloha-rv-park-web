import { supabaseAdmin } from "@/lib/supabase-admin";
import { rowWants, wantsSecurityIp } from "@/lib/notifyPrefs";

// Oct 29 (per Mely — Notification Preferences): helpers for the admin bell and admin emails written
// from the park website. The admin app (melyos-builder /api/push/dispatch) then sends Phone/Email
// per each admin's preferences; the bell list hides what each admin turned off. Never throws.

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(String(e.message || "")));

/**
 * Writes ONE admin bell row for this company, only the first time for `onceKey` (e.g. the
 * PaymentIntent). Marker in admin_notification_markers (scripts/notification_prefs.sql); before
 * that SQL runs, an existing bell row of the same type whose message carries `ref` counts instead.
 */
export async function notifyAdminBellOnce(p: {
  companyId: string;
  onceKey: string;
  updateType: string;
  message: string;
  ref: string;
  residentId?: string | null;
  residentName?: string | null;
}): Promise<boolean> {
  try {
    if (!p.companyId) return false;
    const { error: mErr } = await supabaseAdmin.from("admin_notification_markers").insert({ key: p.onceKey, company_id: p.companyId });
    if (mErr) {
      if (mErr.code === "23505") return false; // already done
      if (!missingTable(mErr)) return false;   // unknown problem: don't risk a duplicate
      const { data: seen, error: sErr } = await supabaseAdmin.from("resident_update_notifications").select("id")
        .eq("company_id", p.companyId).eq("update_type", p.updateType).like("message", `%${p.ref.replace(/[%_]/g, "")}%`).limit(1);
      if (sErr || seen?.length) return false;
    }
    const { error } = await supabaseAdmin.from("resident_update_notifications").insert({
      company_id: p.companyId,
      resident_id: p.residentId || null,
      resident_name: p.residentName || null,
      update_type: p.updateType,
      message: p.message,
    });
    if (error) {
      await supabaseAdmin.from("admin_notification_markers").delete().eq("key", p.onceKey).then(() => null, () => null);
      console.error("notifyAdminBellOnce:", error.message);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error("notifyAdminBellOnce:", e?.message || e);
    return false;
  }
}

export const isDemoCompanyRow = (co: { is_demo?: boolean | null; domain?: string | null } | null | undefined) =>
  !!co?.is_demo || /(^|\.)melyos\.io$/i.test(String(co?.domain || ""));

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

/** Emails of the company's admins who want this event by Email ([] for demo companies or on error). */
export async function adminEmailsFor(companyId: string, eventKey: string): Promise<string[]> {
  try {
    const [{ data: co }, { data: admins, error }] = await Promise.all([
      supabaseAdmin.from("companies").select("is_demo, domain").eq("id", companyId).maybeSingle(),
      supabaseAdmin.from("admin_users").select("*").eq("company_id", companyId),
    ]);
    if (!co || isDemoCompanyRow(co) || error || !admins) return [];
    const out = new Set<string>();
    for (const a of admins as any[]) {
      if (a.active === false || a.is_active === false || a.deleted_at || a.archived_at || a.disabled === true) continue;
      const email = String(a.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(email) && rowWants(a, eventKey, "email")) out.add(email);
    }
    return [...out];
  } catch {
    return [];
  }
}

/** Include the IP in this company's security alerts? Yes when any admin wants it (as before). */
export async function companyWantsSecurityIp(companyId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.from("admin_users").select("*").eq("company_id", companyId);
    if (!data || !data.length) return true;
    return (data as any[]).some((a) => wantsSecurityIp(a));
  } catch {
    return true;
  }
}
