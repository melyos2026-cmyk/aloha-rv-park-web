import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/cancel-maintenance-request
// Body: { residentId, requestId }
export async function POST(req: NextRequest) {
  const { residentId, requestId } = await req.json();

  if (!residentId || !requestId) {
    return NextResponse.json({ error: "residentId and requestId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { error } = await supabase
    .from("maintenance_requests")
    .update({ status: "Cancelled" })
    .eq("id", requestId)
    .eq("resident_id", residentId)
    .eq("status", "Open");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
