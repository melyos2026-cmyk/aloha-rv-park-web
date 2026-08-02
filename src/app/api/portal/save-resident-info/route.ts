import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/save-resident-info
// Body: { residentId, phone }
// Replaces the previous direct client-side Supabase write in
// residents/dashboard/page.tsx (saveResidentInfo), which was protected only
// by RLS (if any) rather than by the real session check added below.
export async function POST(req: NextRequest) {
  const { residentId, phone } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: fetchError } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (fetchError || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("resident_accounts")
    .update({ phone: (phone || "").trim() })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    resident_name: resident.full_name,
    update_type: "resident_info",
    message: `${resident.full_name} updated their phone number to ${(phone || "").trim()}.`,
  });

  return NextResponse.json({ success: true });
}
