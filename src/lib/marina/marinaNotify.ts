import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 27 (per Mely — "Notification Preferences … adaptar para marinas"): besides the office email,
// each admin chooses in Settings which marina emails they also get in their OWN email.
// Saved on admin_users.marina_notify (jsonb, scripts/marina_87_marina_notify.sql). Off by default.
// Same list in the admin app: lib/marinaNotify.ts — keep both in sync.
export const MARINA_NOTIFY = [
  { key: "requests", title: "Slip requests", description: "New slip requests, a boater accepts or says no to the price, signs, or is confirmed" },
  { key: "documents", title: "Documents to review", description: "A boater uploads insurance, registration or another document" },
  { key: "contracts", title: "Contracts", description: "A boater signs a contract, or a contract needs the marina's second signature" },
  { key: "store", title: "Ship Store orders", description: "A new order comes in (paid by card or charged to the account)" },
  { key: "waitlist", title: "Waitlist", description: "A slip frees up for a boat on the waitlist, or an offer runs out" },
  { key: "payments", title: "Payments & autopay", description: "Autopay summary of the day and bank payments that come back", managers: true },
  { key: "daily_report", title: "End-of-day report", description: "Every morning: what came in yesterday, by method and by area", managers: true },
  { key: "cash", title: "Cash drawer", description: "A cash drawer is short or over", managers: true },
] as const;
export type MarinaNotifyKind = (typeof MARINA_NOTIFY)[number]["key"];
const MANAGER_ONLY = new Set<string>(MARINA_NOTIFY.filter((x) => (x as any).managers).map((x) => x.key));
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

export function cleanMarinaNotify(input: unknown, isManager: boolean): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!input || typeof input !== "object") return out;
  for (const { key } of MARINA_NOTIFY) {
    const v = (input as any)[key];
    if (typeof v === "boolean" && (isManager || !MANAGER_ONLY.has(key))) out[key] = v;
  }
  return out;
}

// The company's admins who turned this kind on (managers-only kinds: managers only).
export async function personalRecipients(companyId: string, kind: MarinaNotifyKind | undefined, alsoIds: string[] = []): Promise<string[]> {
  if (!kind && !alsoIds.length) return [];
  const { data, error } = await supabaseAdmin.from("admin_users").select("*").eq("company_id", companyId);
  if (error || !data) return [];
  const out = new Set<string>();
  for (const u of data as any[]) {
    if (u.active === false || u.is_active === false || u.deleted_at || u.archived_at) continue;
    const email = String(u.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    const wants = !!kind && u.marina_notify?.[kind] === true && (!MANAGER_ONLY.has(kind) || u.can_manage_money);
    if (wants || alsoIds.includes(u.id)) out.add(email);
  }
  return [...out];
}
