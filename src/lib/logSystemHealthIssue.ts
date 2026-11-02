import { supabaseAdmin } from "@/lib/supabase-admin";

// Sep 20 (per Mely — same helper as melyos-builder's copy): call this
// anywhere a real failure is detected so it shows up on the admin's
// System Health screen instead of only ever being visible in server
// logs nobody reads. Best-effort — never throws.
export async function logSystemHealthIssue(params: {
  companyId: string;
  issueType: string;
  message: string;
  residentId?: string | null;
  source?: string;
  /** Nov 2 (per Mely): also put it in the park admin's bell (default). false for things that
   *  aren't a problem the park has to handle (e.g. a visitor closed a checkout page). */
  parkBell?: boolean;
}): Promise<void> {
  try {
    await supabaseAdmin.from("system_health_issues").insert({
      company_id: params.companyId,
      issue_type: params.issueType,
      resident_id: params.residentId || null,
      message: params.message,
      source: params.source || null,
    });
  } catch (err: any) {
    console.error("logSystemHealthIssue failed:", err.message);
  }

  // Nov 2 (per Mely — "a red bubble for the admin"): same as melyos-builder's copy — the park
  // admin's bell gets it too, so a bounced email or a failed payment isn't only seen by whoever
  // opens System Health. Capped at 20 an hour per park (anyone can trigger some of these, e.g.
  // the chat's emergency report). Best-effort: never hides the issue above or breaks the caller.
  if (params.parkBell === false) return;
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabaseAdmin.from("resident_update_notifications").select("id", { count: "exact", head: true })
      .eq("company_id", params.companyId).eq("update_type", "system_health_issue").gte("created_at", since);
    if ((count || 0) >= 20) return;
    await supabaseAdmin.from("resident_update_notifications").insert({
      company_id: params.companyId,
      resident_name: "System Health",
      update_type: "system_health_issue",
      message: `⚠️ ${params.message}`.slice(0, 1000),
    });
  } catch (err: any) {
    console.error("logSystemHealthIssue notification failed:", err.message);
  }
}
