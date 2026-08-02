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

  // SECURITY: don't trust residentId + companyId as a matching pair from the
  // client — verify the resident actually belongs to this companyId before
  // using their name or inserting a notification tagged to it. Without this,
  // anyone could POST a real residentId from a DIFFERENT company alongside
  // an arbitrary companyId and (a) leak that resident's name into the wrong
  // company's notification feed, or (b) spam any company's notification
  // bell with fake maintenance-request alerts. The normal app flow already
  // always sends a resident's own company_id (residents/maintenance/page.tsx
  // fetches it fresh right before calling this), so this check doesn't
  // change anything for legitimate calls.
  let residentName: string | null = null;
  if (residentId) {
    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("full_name, company_id")
      .eq("id", residentId)
      .maybeSingle();

    if (!resident || resident.company_id !== companyId) {
      return NextResponse.json({ error: "Resident does not belong to this company." }, { status: 403 });
    }
    residentName = resident.full_name || null;
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
