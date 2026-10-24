import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 24 (per Mely — "aquí no se fía"): each marina decides whether boaters may charge purchases
// to their account (pay later) or must pay before they take anything. OFF unless the marina turns
// it on (admin: Ship Store → Online orders → ⚙, Fuel Dock or Concierge settings). Stored in
// company_modules as "marina_charge_to_account", like the other per-marina switches.
export async function accountChargesAllowed(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from("company_modules").select("enabled")
    .eq("company_id", companyId).eq("module_name", "marina_charge_to_account").maybeSingle();
  return !error && !!data?.enabled;
}
