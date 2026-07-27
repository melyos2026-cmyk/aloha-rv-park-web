import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// POST /api/portal/dismiss-propane-order
// Body: { orderId }
// Soft-hides the order from the resident's own portal view — does not
// delete the underlying record, so staff can still look it up if needed.
export async function POST(req: NextRequest) {
  const { orderId } = await req.json();

  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
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
