import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/propane-orders?residentId=...
// Matches orders either by the resident's email or by the lot number they
// typed in at checkout (residents without an email on the order can still
// be matched this way).
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  // SECURITY: require the caller's own signed session to match this
  // residentId — otherwise anyone could read another resident's propane
  // purchase history/QR pickup codes just by knowing/guessing their id.
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: residentError } = await supabase
    .from("resident_accounts")
    .select("email, rv_lots(lot_name)")
    .eq("id", residentId)
    .single();

  if (residentError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const lotName = (resident as any).rv_lots?.lot_name;
  const email = resident.email;

  let query = supabase
    .from("propane_orders")
    .select(
      "id, product_label, quantity, unit, amount_total, paid_at, qr_token, redeemed, redeemed_at, redeemed_count, dismissed_by_resident"
    )
    .eq("dismissed_by_resident", false)
    .order("paid_at", { ascending: false });

  if (email && lotName) {
    query = query.or(`customer_email.eq.${email},resident_lot_name.eq.${lotName}`);
  } else if (email) {
    query = query.eq("customer_email", email);
  } else if (lotName) {
    query = query.eq("resident_lot_name", lotName);
  } else {
    return NextResponse.json({ orders: [] });
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data ?? [] });
}
