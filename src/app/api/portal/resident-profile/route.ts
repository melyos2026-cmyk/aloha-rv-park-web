import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/resident-profile?residentId=...
//
// Aug 7 (per Mely, CRITICAL real gap found): residents/dashboard/page.tsx
// queried resident_accounts DIRECTLY from the browser with the anon key,
// trusting a residentId read from localStorage. resident_accounts' anon
// SELECT policy is `portal_enabled = true AND deleted_at IS NULL` — with
// NO id-scoping at all — meaning ANY unauthenticated client could read
// EVERY resident's full profile across EVERY company with portal access
// enabled, no login or guessing required. Same server-route-with-session-
// check fix used everywhere else this class of bug has been hit in this
// project, matching the active-lease route's pattern exactly.
const RESIDENT_PROFILE_FIELDS = [
  "id", "company_id", "full_name", "email", "phone",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship",
  "autopay_enabled", "autopay_card_last4", "autopay_authorized_at", "autopay_method",
  "rv_type", "rv_make", "rv_model", "rv_year", "rv_length_ft", "rv_width_ft", "rv_vin_or_tag",
  "rent_amount", "mailbox_number", "mailbox_keys_count", "gate_clickers_count",
  "parking_provided", "parking_spaces", "parking_free", "parking_cost",
  "pets_allowed", "pets_count", "pets_types", "pet_details", "golf_carts",
  "rv_lots", "companies",
  // Oct 30 (storage-only customers): 'resident' | 'storage' (missing column → not sent → 'resident').
  "account_type",
];

export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: row, error } = await supabase
    .from("resident_accounts")
    .select("*, rv_lots(lot_name), companies(company_name)")
    .eq("id", residentId)
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not load your profile." }, { status: 500 });
  }

  // Oct 26 (security review): return ONLY the fields the resident dashboard (and its GolfCartCard)
  // uses — never portal_password, reset/invite tokens, Stripe ids or admin-only notes. The row is
  // still read with * so a column missing in one database can't break the dashboard; the allow-list
  // below decides what leaves the server. Add a field here if the dashboard starts using it.
  const resident: Record<string, any> = {};
  for (const k of RESIDENT_PROFILE_FIELDS) if (row && (row as any)[k] !== undefined) resident[k] = (row as any)[k];

  // Oct 30 (per Mely): a storage customer (rents an RV storage space, doesn't live in the park) sees
  // their space(s), what is stored and the monthly storage price — from their own active "Storage
  // Rental" recurring charge(s), same company only.
  if (String((row as any)?.account_type || "") === "storage") {
    const { data: rc } = await supabase
      .from("recurring_charges")
      .select("amount, storage_spaces")
      .eq("resident_id", residentId)
      .eq("company_id", (row as any).company_id)
      .eq("charge_type", "Storage Rental")
      .eq("active", true);
    const spaces = Array.from(new Set((rc || []).flatMap((c: any) => (Array.isArray(c.storage_spaces) ? c.storage_spaces : []).map((x: any) => String(x)))));
    resident.storage_spaces = spaces.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    resident.storage_monthly = Math.round((rc || []).reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0) * 100) / 100;
    resident.storage_active = (rc || []).length > 0;
    // rv_description stays office-only (same rule as for residents); the type + plate/VIN are theirs.
    resident.storage_unit = String((row as any).rv_type || "");
  }

  return NextResponse.json({ resident });
}
