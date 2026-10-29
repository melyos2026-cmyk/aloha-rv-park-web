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
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: changed, error } = await supabase
    .from("resident_accounts")
    .update({ autopay_enabled: false })
    .eq("id", residentId)
    .eq("autopay_enabled", true)
    .select("id, company_id, full_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Oct 29 (Notification Preferences "Autopay turned on / off"): tell the office — only when it was
  // really on (a repeat click changes nothing and adds no second bell). Best-effort.
  const r = changed?.[0];
  if (r?.company_id) {
    await supabase.from("resident_update_notifications").insert({
      company_id: r.company_id, resident_id: r.id, resident_name: r.full_name || null, update_type: "autopay_disabled",
      message: `${r.full_name || "A resident"} turned off autopay from the resident portal.`,
    }).then(() => null, () => null);
  }

  return NextResponse.json({ success: true });
}
