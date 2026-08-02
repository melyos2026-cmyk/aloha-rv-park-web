import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/dismiss-propane-order
// Body: { orderId, residentId }
// Soft-hides the order from the resident's own portal view — does not
// delete the underlying record, so staff can still look it up if needed.
export async function POST(req: NextRequest) {
  const { orderId, residentId } = await req.json();

  if (!orderId || !residentId) {
    return NextResponse.json({ error: "orderId and residentId are required." }, { status: 400 });
  }

  // SECURITY: require the caller's own signed session to match this
  // residentId, AND confirm the order actually belongs to them (by the
  // same email/lot match propane-orders GET uses) before hiding it —
  // otherwise anyone could dismiss another resident's propane order from
  // their own view just by knowing/guessing its id.
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("email, rv_lots(lot_name)")
    .eq("id", residentId)
    .maybeSingle();

  const lotName = (resident as any)?.rv_lots?.lot_name;
  const email = resident?.email;

  const { data: order } = await supabase
    .from("propane_orders")
    .select("id, customer_email, resident_lot_name")
    .eq("id", orderId)
    .maybeSingle();

  const belongsToResident =
    order && ((email && order.customer_email === email) || (lotName && order.resident_lot_name === lotName));

  if (!belongsToResident) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("propane_orders")
    .update({ dismissed_by_resident: true })
    .eq("id", orderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
