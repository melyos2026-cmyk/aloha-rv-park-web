import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Oct 28 (per Mely): is "Residents can send maintenance requests from their portal" ON for this park?
// Set in the admin (melyos-builder Maintenance Requests module) and stored in
// park_settings.lease_defaults.portal_maintenance_requests. DEFAULT OFF; a failed read = off.
export async function portalMaintenanceEnabled(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const { data, error } = await supabase.from("park_settings").select("lease_defaults").eq("company_id", companyId).maybeSingle();
  if (error) return false;
  return (data?.lease_defaults as any)?.portal_maintenance_requests === true;
}

export const MAINTENANCE_OFF_MESSAGE = "Maintenance requests are handled by the office — please call or message us.";
