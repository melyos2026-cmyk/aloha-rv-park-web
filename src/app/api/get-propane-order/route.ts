import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/get-propane-order?session_id=...
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("propane_orders")
    .select("product_label, quantity, unit, amount_total, qr_token, redeemed")
    .eq("stripe_session_id", sessionId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Order not found yet — please wait a moment and refresh." }, { status: 404 });
  }

  return NextResponse.json({ order: data });
}
