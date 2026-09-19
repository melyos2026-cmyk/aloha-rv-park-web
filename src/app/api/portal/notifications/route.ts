import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/notifications?residentId=...
// Every notification meant for this resident — sent either
// automatically by the system (a new invoice, an electric reading, a
// maintenance update, an announcement, a household background-check
// result) or manually by the admin. Newest first.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data, error } = await supabase
    .from("resident_update_notifications")
    .select("id, message, update_type, resident_read_at, created_at")
    .eq("resident_id", residentId)
    .eq("resident_facing", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data || [] });
}

// PATCH /api/portal/notifications
// Body: { residentId, id } marks one as read, or { residentId, markAllRead: true }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { residentId, id, markAllRead } = body;
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const now = new Date().toISOString();

  if (markAllRead) {
    const { error } = await supabase
      .from("resident_update_notifications")
      .update({ resident_read_at: now })
      .eq("resident_id", residentId)
      .eq("resident_facing", true)
      .is("resident_read_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!id) {
    return NextResponse.json({ error: "id or markAllRead is required." }, { status: 400 });
  }
  const { error } = await supabase
    .from("resident_update_notifications")
    .update({ resident_read_at: now })
    .eq("id", id)
    .eq("resident_id", residentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
