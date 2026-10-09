import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST   { residentId, subscription }  — register this device for the resident's alerts
// DELETE { residentId, endpoint }      — turn alerts off for this device
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { residentId, subscription } = body;
  if (!residentId) return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
  }
  const { data: resident } = await supabase.from("resident_accounts").select("company_id").eq("id", residentId).maybeSingle();
  if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      company_id: resident.company_id,
      audience: "resident",
      user_id: String(residentId),
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { residentId, endpoint } = body;
  if (!residentId || !endpoint) return NextResponse.json({ error: "residentId and endpoint are required." }, { status: 400 });
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", String(residentId)).eq("audience", "resident");
  return NextResponse.json({ success: true });
}
