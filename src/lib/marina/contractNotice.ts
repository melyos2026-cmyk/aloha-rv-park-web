import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 27 (per Mely — like real marinas): ending a month-to-month dockage agreement with written
// notice. It ends on the last day of the monthly period in which the notice period ends.
// Same rule as the admin app: lib/marinaMonthToMonth.ts — keep both in sync.
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function addMonthsISO(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
export function endsOnFor(k: { end_date: string }, noticeDate: string, noticeDays: number): string {
  const target = addDays(noticeDate, Math.max(0, noticeDays));
  let end = k.end_date;
  for (let i = 0; i < 240 && end < target; i++) end = addDays(addMonthsISO(addDays(end, 1), 1), -1);
  return end;
}
export async function giveNotice(companyId: string, k: any, by: string): Promise<{ error?: string; endsOn?: string }> {
  if (!k.month_to_month) return { error: "Only a month-to-month agreement ends with notice. Yours ends on its end date." };
  if (k.status !== "signed") return { error: "This contract isn't signed yet." };
  if (k.notice_given_at) return { error: `Notice was already given; the last day is ${k.ends_on}.` };
  const endsOn = endsOnFor(k, todayET(), Number(k.notice_days ?? 30));
  const { data, error } = await supabaseAdmin.from("marina_contracts").update({ notice_given_at: new Date().toISOString(), notice_given_by: by.slice(0, 120), ends_on: endsOn })
    .eq("id", k.id).eq("company_id", companyId).is("notice_given_at", null).select("id").maybeSingle();
  if (error || !data) return { error: "Notice could not be saved. Please contact the office." };
  return { endsOn };
}
