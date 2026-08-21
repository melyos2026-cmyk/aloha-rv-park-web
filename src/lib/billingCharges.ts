import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Aug 21 (per Mely — "todavia no se ve claro cuanto gana por background
// check... una parte nueva debajo de Setting que se llame Billing...
// Charges: en una tabla... esto debe estar conectado a background
// payments para que a la compania le quede claro"): every time MelyOS's
// Checkr cost is deducted from a company's share at checkout (the
// Connect split built Aug 20), this records a permanent, itemized row
// the company can see for themselves under Settings > Billing > Charges
// — instead of that split just happening invisibly inside a Stripe
// transaction with no visible paper trail on the company's own side.
//
// billing_seq is sequential PER COMPANY (not global) so each company's
// numbering starts at 1 — computed as MAX+1 rather than a DB sequence
// since charge volume is low and this only ever runs from a webhook
// (no concurrent-request risk in practice for a single company).
export async function recordMelyOSBillingCharge(params: {
  companyId: string;
  chargeType: string;
  source: string;
  description: string;
  amount: number;
  markup: number;
  residentApplicationId?: string | null;
}): Promise<void> {
  const { companyId, chargeType, source, description, amount, markup, residentApplicationId } = params;

  const { data: lastRow } = await supabase
    .from("melyos_billing_charges")
    .select("billing_seq")
    .eq("company_id", companyId)
    .order("billing_seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextSeq = (lastRow?.billing_seq || 0) + 1;

  const { error } = await supabase.from("melyos_billing_charges").insert({
    company_id: companyId,
    billing_seq: nextSeq,
    charge_date: new Date().toISOString().slice(0, 10),
    charge_type: chargeType,
    source,
    description,
    amount,
    markup,
    resident_application_id: residentApplicationId || null,
  });

  if (error) {
    console.error("recordMelyOSBillingCharge failed:", error.message);
  }
}

// Formats a sequence number as the "BC-00001" style billing number Mely
// asked for, computed at display/insert time from billing_seq rather
// than stored as its own text column (keeps the numeric column sortable
// and avoids ever having to reformat stored strings later).
export function formatBillingNumber(seq: number): string {
  return `BC-${String(seq).padStart(5, "0")}`;
}
