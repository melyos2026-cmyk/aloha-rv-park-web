import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/delete-occupant
// Body: { residentId, occupantId }
// Replaces the previous direct client-side Supabase delete in
// residents/dashboard/page.tsx (deleteVisitor).
export async function POST(req: NextRequest) {
  const { residentId, occupantId } = await req.json();

  if (!residentId || !occupantId) {
    return NextResponse.json({ error: "residentId and occupantId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  // SECURITY: confirm this occupant actually belongs to the session's own
  // resident before deleting it — otherwise anyone could remove a
  // different resident's household member/visitor just by knowing/guessing
  // the occupant's id.
  const { data: existing } = await supabase
    .from("resident_occupants")
    .select("id, resident_id, occupant_type, full_name")
    .eq("id", occupantId)
    .maybeSingle();

  if (!existing || existing.resident_id !== residentId) {
    return NextResponse.json({ error: "Occupant not found." }, { status: 404 });
  }

  const { error } = await supabase.from("resident_occupants").delete().eq("id", occupantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const isVisitor = existing.occupant_type === "visitor";
  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    resident_name: resident.full_name,
    update_type: isVisitor ? "visitor_removed" : "occupant_removed",
    message: `${resident.full_name} removed a ${isVisitor ? "visitor" : "household occupant"}${existing.full_name ? `: ${existing.full_name}` : ""}.`,
  });

  return NextResponse.json({ success: true });
}
