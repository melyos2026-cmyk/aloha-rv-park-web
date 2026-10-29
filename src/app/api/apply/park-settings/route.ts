import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/apply/park-settings?company_id=...
// Oct 29 (security review): the application page used to read park_settings straight from the
// browser with the public key — including the whole lease_defaults JSON, which also holds private
// office settings (payout terms with the manager's name/email/IP, auto-assign switches, portal
// info…). The public key can no longer read that column. This returns only what the application
// form shows an applicant: the billing policy/season dates and the lease-term defaults the form
// pre-fills (fees, deposits, rules, clauses).
const PUBLIC_LEASE_DEFAULT_KEYS = [
  "landlord_name", "landlord_address", "property_address",
  "notice_days", "month_to_month", "rent_amount", "rent_due_day", "rent_payment_instructions", "use_seasonal_pricing",
  "late_fee_enabled", "late_fee_amount", "late_fee_grace_days",
  // Oct 29: how often the late fee repeats — the form's Late Fee line reads these (it used to
  // always say "per day"); the admin's Lease Defaults editor sets them.
  "late_fee_frequency", "late_fee_charge_days", "late_fee_max",
  "security_deposit_enabled", "security_deposit_amount", "security_deposit_return_days",
  "nsf_fee_enabled", "nsf_fee_amount",
  "occupants_enabled", "vehicles_enabled",
  "golf_carts_max", "golf_cart_insurance_required", "parking_sticker_name",
  "parking_sticker_replacement_fee", "gate_clicker_replacement_fee", "mailbox_key_replacement_fee",
  "utilities_included", "utilities_included_short_stay", "hazardous_materials_clause",
  "parking_provided", "parking_spaces", "parking_free", "parking_cost", "parking_payment_timing",
  "pets_allowed", "pet_deposit", "pet_restrictions",
  "smoking_policy", "smoking_areas", "additional_provisions",
  "rv_removal_days", "rv_removal_storage_fee", "rv_removal_clause",
  "electric_type", "electric_included_kwh", "electric_rate_per_kwh",
  "laundry_type", "laundry_monthly_fee",
  "park_rules",
  "application_fee_primary", "application_fee_per_additional", "application_processing_fee",
  "background_check_threshold_days", "first_month_proration_method",
];

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("park_settings")
    .select("rent_due_day_policy, rent_due_day_fixed, high_season_start_month_day, high_season_end_month_day, lease_defaults")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load the park's settings." }, { status: 500 });
  if (!data) return NextResponse.json({ settings: null });
  const all = (data.lease_defaults && typeof data.lease_defaults === "object" ? data.lease_defaults : {}) as Record<string, unknown>;
  const lease_defaults: Record<string, unknown> = {};
  for (const k of PUBLIC_LEASE_DEFAULT_KEYS) if (all[k] !== undefined) lease_defaults[k] = all[k];
  return NextResponse.json(
    {
      settings: {
        rent_due_day_policy: data.rent_due_day_policy ?? null,
        rent_due_day_fixed: data.rent_due_day_fixed ?? null,
        high_season_start_month_day: data.high_season_start_month_day ?? null,
        high_season_end_month_day: data.high_season_end_month_day ?? null,
        lease_defaults,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
