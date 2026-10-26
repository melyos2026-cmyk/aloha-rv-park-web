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
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: residentError } = await supabase
    .from("resident_accounts")
    .select("email, company_id, rv_lots(lot_name), companies(park_id)")
    .eq("id", residentId)
    .single();

  if (residentError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const lotName = (resident as any).rv_lots?.lot_name as string | undefined;
  const email = resident.email as string | null;
  // Oct 22 (security, per Mely — "payments can never cross between companies"): only this
  // resident's own park, and exact matches only (the email/lot used to be pasted into a
  // filter string, which could be abused to list every park's orders and QR codes).
  const parkId = (resident as any).companies?.park_id as string | undefined;
  if (!parkId || (!email && !lotName)) return NextResponse.json({ orders: [] });

  const cols = "id, product_label, quantity, unit, amount_total, paid_at, qr_token, redeemed, redeemed_at, redeemed_count, dismissed_by_resident";
  const base = () => supabase.from("propane_orders").select(cols).eq("park_id", parkId).eq("dismissed_by_resident", false);
  const [byEmail, byLot] = await Promise.all([
    email ? base().eq("customer_email", email) : Promise.resolve({ data: [], error: null } as any),
    lotName ? base().eq("resident_lot_name", lotName) : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (byEmail.error || byLot.error) {
    console.error("portal propane-orders:", byEmail.error?.message || byLot.error?.message);
    return NextResponse.json({ error: "Could not load your propane orders." }, { status: 500 });
  }
  // Oct 26 (security review): a resident can change their own email (save-resident-info) to the
  // email a guest used at checkout. Orders matched ONLY by email are still listed, but without the
  // pickup QR code (qr_token) — that stays with the buyer's own email/receipt. Orders on the
  // resident's own lot keep the QR as before.
  const lotIds = new Set((byLot.data || []).map((o: any) => o.id));
  const seen = new Set<string>();
  const data = [...(byLot.data || []), ...(byEmail.data || [])]
    .filter((o: any) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .map((o: any) => (lotIds.has(o.id) ? o : { ...o, qr_token: null }))
    .sort((a: any, b: any) => String(b.paid_at || "").localeCompare(String(a.paid_at || "")));

  return NextResponse.json({ orders: data ?? [] });
}
