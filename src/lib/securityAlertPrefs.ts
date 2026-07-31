import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Security alerts (failed login attempts, unrequested password resets) are
// opt-out, not opt-in — default to true when the column hasn't been
// explicitly set, so we only skip if an admin has actively turned it off.
export async function companyWantsSecurityAlerts(companyId: string): Promise<boolean> {
  const { data: admins } = await supabaseAdmin
    .from("admin_users")
    .select("notify_security_alerts")
    .eq("company_id", companyId);

  if (!admins || admins.length === 0) return true;
  return admins.some((a) => a.notify_security_alerts !== false);
}
