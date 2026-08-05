import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/create-maintenance-request
// Body: { residentId, subject, description, priority }
// Aug 5 (per Mely — final piece of the recurring RLS/session-verification
// pattern found across the whole portal): maintenance_requests previously
// inserted directly from the browser with the anon key and zero session
// check.
export async function POST(req: NextRequest) {
  const { residentId, subject, description, priority } = await req.json();

  if (!residentId || !subject?.trim()) {
    return NextResponse.json({ error: "residentId and subject are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: residentError } = await supabase
    .from("resident_accounts")
    .select("id, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (residentError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { data: request, error } = await supabase
    .from("maintenance_requests")
    .insert({
      company_id: resident.company_id,
      resident_id: residentId,
      subject: subject.trim(),
      description: (description || "").trim(),
      priority: priority || "Normal",
      status: "Open",
    })
    .select()
    .single();

  if (error || !request) {
    return NextResponse.json({ error: error?.message || "Could not create request." }, { status: 500 });
  }

  return NextResponse.json({ success: true, request });
}
