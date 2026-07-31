import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type SecurityAlertPrefs = {
  failedLogins: boolean;
  passwordResets: boolean;
  includeIp: boolean;
};

// Security alerts are opt-out, not opt-in — default to true when a column
// hasn't been explicitly set, so we only skip if an admin actively turned it
// off. If ANY admin at the company wants a given alert type, we send it.
export async function getSecurityAlertPrefs(companyId: string): Promise<SecurityAlertPrefs> {
  const { data: admins } = await supabaseAdmin
    .from("admin_users")
    .select("notify_security_failed_logins, notify_security_password_resets, notify_security_include_ip")
    .eq("company_id", companyId);

  if (!admins || admins.length === 0) {
    return { failedLogins: true, passwordResets: true, includeIp: true };
  }

  return {
    failedLogins: admins.some((a) => a.notify_security_failed_logins !== false),
    passwordResets: admins.some((a) => a.notify_security_password_resets !== false),
    includeIp: admins.some((a) => a.notify_security_include_ip !== false),
  };
}

