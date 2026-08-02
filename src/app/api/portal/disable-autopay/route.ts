import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/disable-autopay
// Body: { residentId }
// Turns off autopay — keeps the saved card on file in case they want to
// re-enable later without re-entering it, just stops auto-charging.
export async function POST(req: NextRequest) {
  const { residentId } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  // SECURITY: require the caller's own signed session to match this
  // residentId — otherwise anyone could turn off billing/autopay on a
  // DIFFERENT resident's account just by knowing/guessing their id.
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { error } = await supabase
    .from("resident_accounts")
    .update({ autopay_enabled: false })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
