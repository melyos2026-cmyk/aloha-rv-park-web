import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/get-application-invite?token=...
// Aug 11: found while testing a real invite link — apply/page.tsx was
// reading resident_applications directly with the anon-key browser client
// (`.eq("invite_token", inviteToken)`), which resident_applications' RLS
// silently blocks (Supabase returns zero rows, not an error), so every
// invite link showed "This invitation link is invalid or has expired"
// even for a freshly-created, real invitation. Same recurring RLS-gap
// pattern hit throughout this project — fixed the same way: moved the
// read behind the Service Role Key. This is public/unauthenticated by
// design (the applicant isn't logged in yet) but scoped to a single
// unguessable token, and only returns the specific fields the apply form
// actually needs to prefill — not the full row.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("resident_applications")
    .select(
      "id, company_id, is_rent_to_own, is_returning_resident, background_check_override, " +
        "is_family_friend, full_name, tenant_names, email, phone, space_id, lease_start, lease_end, " +
        "monthly_rent, security_deposit, electric_type, electric_included_kwh, electric_rate_per_kwh, " +
        "laundry_type, laundry_monthly_fee, rent_to_own_total_price, rent_to_own_monthly_payment, " +
        "rent_to_own_num_payments, rent_to_own_deposit, rent_to_own_deposit_paid, " +
        "rv_make, rv_model, rv_year, rv_length_ft, rv_vin_or_tag, slide_out_driver_count, slide_out_passenger_count"
    )
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }

  return NextResponse.json({ invitation: data });
}
