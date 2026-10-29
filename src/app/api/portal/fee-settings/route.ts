import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import {
  PROCESSING_FEE_PERCENT, PROCESSING_FEE_MINIMUM,
  ACH_FEE_PERCENT, ACH_FEE_MINIMUM, ACH_FEE_MAXIMUM, ACH_RETURN_FEE,
  loadReturnedFeeSettings, returnedFeePhrase,
} from "@/lib/platformFee";

// GET /api/portal/fee-settings?residentId=...
// FOUND (Aug 3): company_fee_settings was being read directly with the
// anon key client-side (residents/dashboard/page.tsx), which is very
// likely blocked by RLS the same way resident_occupants/resident_vehicles
// were (see commit 6730b12) — this would silently make autopayAvailable
// always false, hiding the Autopay section entirely regardless of the
// actual setting. Moved to a server route (Service Role Key) to rule this
// out for good, matching the established fix pattern in this codebase.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: residentError } = await supabase
    .from("resident_accounts")
    .select("company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (residentError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { data: feeSettings, error } = await supabase
    .from("company_fee_settings")
    .select("accept_online_payments, autopay_available, pass_processing_fee_to_resident, ach_enabled, ach_min_amount")
    .eq("company_id", resident.company_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Aug 6 (per Mely): also return the park's configured move-out notice
  // period so the Moving Out card can tell residents how much notice to
  // give, instead of them guessing.
  const { data: parkSettings } = await supabase
    .from("park_settings")
    .select("move_out_threshold_days, lease_defaults")
    .eq("company_id", resident.company_id)
    .maybeSingle();

  return NextResponse.json({
    // Online payments are always accepted (Aug 3) — no longer a toggle in
    // admin's Fee Settings, so this ignores whatever's stored in the
    // column and is just always true.
    acceptOnlinePayments: true,
    autopayAvailable: !!feeSettings?.autopay_available,
    moveOutThresholdDays: parkSettings?.move_out_threshold_days ?? 15,
    // Oct 19 (per Mely): the park's restricted-breed notice, shown in the
    // portal's Pets section (same text as the application).
    petRestrictions: (parkSettings as any)?.lease_defaults?.pet_restrictions || "",
    // Oct 19 (per Mely): golf cart settings from Lease Defaults
    golfCartsMax: (() => {
      const v = (parkSettings as any)?.lease_defaults?.golf_carts_max;
      return v === undefined || v === "" || v === null ? 2 : Number(v) || 0;
    })(),
    golfCartInsuranceRequired: (parkSettings as any)?.lease_defaults?.golf_cart_insurance_required !== false,
    // Oct 28 (per Mely): "Residents can send maintenance requests from their portal" — the park's
    // switch in the admin Maintenance Requests module. DEFAULT OFF (missing = off).
    maintenanceRequestsEnabled: (parkSettings as any)?.lease_defaults?.portal_maintenance_requests === true,
    // Oct 28 (per Mely): bank (ACH) payments in the portal — same rule and fee constants the
    // checkout route uses (src/lib/platformFee.ts), so the portal shows the exact fee for each choice.
    // Oct 28 (per Mely): bank options (pay by bank, bank autopay, the "pay by bank" banner) only when
    // the admin has bank payments explicitly ON — not when the setting was never saved.
    achEnabled: feeSettings?.ach_enabled === true,
    achMinAmount: (() => {
      const m = Number(feeSettings?.ach_min_amount ?? 100);
      return Number.isFinite(m) ? m : 100;
    })(),
    passProcessingFeeToResident: feeSettings?.pass_processing_fee_to_resident !== false,
    fees: {
      cardPercent: PROCESSING_FEE_PERCENT,
      cardMinimum: PROCESSING_FEE_MINIMUM,
      achPercent: ACH_FEE_PERCENT,
      achMinimum: ACH_FEE_MINIMUM,
      achMaximum: ACH_FEE_MAXIMUM,
      achReturnFee: ACH_RETURN_FEE,
      // Oct 28 (per Mely): this company's returned-payment fee rule, in words (never MelyOS's share).
      returnFeePhrase: returnedFeePhrase(await loadReturnedFeeSettings(resident?.company_id || null, "rv")),
    },
  });
}
