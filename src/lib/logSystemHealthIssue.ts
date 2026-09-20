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
}
