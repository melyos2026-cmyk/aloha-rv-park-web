import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// POST /api/notify-maintenance-request
// Body: { companyId, residentId, subject, priority }
// Called right after a resident creates a maintenance_requests row from
// their portal, so the admin's notification bell picks it up — this was
// missing before (the ticket saved fine, but nobody got alerted).
export async function POST(req: NextRequest) {
  const { companyId, residentId, subject, priority } = await req.json();

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required." }, { status: 400 });
  }

  let residentName: string | null = null;
  if (residentId) {
    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("full_name")
      .eq("id", residentId)
      .maybeSingle();
    residentName = resident?.full_name || null;
  }

  const { error } = await supabase.from("resident_update_notifications").insert({
    company_id: companyId,
    resident_name: residentName,
    update_type: "maintenance_request",
    message: `${residentName || "A resident"} submitted a maintenance request${priority ? ` (${priority} priority)` : ""}: "${subject}".`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
