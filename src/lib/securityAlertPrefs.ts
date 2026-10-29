import { companyWantsSecurityIp } from "@/lib/adminBell";

export type SecurityAlertPrefs = {
  failedLogins: boolean;
  passwordResets: boolean;
  includeIp: boolean;
};

// Oct 29 (per Mely — Notification Preferences, owner approved): security alerts are CRITICAL — the
// bell row is always written (each admin can still choose Phone/Email for it in the admin app).
// "Include the IP" follows the admins' choice: admin_users.notification_prefs.options
// .security_include_ip, else the old notify_security_include_ip column; any admin wanting it = yes.
export async function getSecurityAlertPrefs(companyId: string): Promise<SecurityAlertPrefs> {
  return { failedLogins: true, passwordResets: true, includeIp: await companyWantsSecurityIp(companyId) };
}
