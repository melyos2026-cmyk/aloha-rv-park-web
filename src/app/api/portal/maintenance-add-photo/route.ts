import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/maintenance-add-photo
// Body: { residentId, requestId, fileUrl }
export async function POST(req: NextRequest) {
  const { residentId, requestId, fileUrl } = await req.json();

  if (!residentId || !requestId || !fileUrl) {
    return NextResponse.json(
      { error: "residentId, requestId, and fileUrl are required." },
      { status: 400 }
    );
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: request } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("id", requestId)
    .eq("resident_id", residentId)
    .maybeSingle();

  if (!request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const { error } = await supabase.from("maintenance_request_photos").insert({
    request_id: requestId,
    file_url: fileUrl,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
