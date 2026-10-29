import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { sniff } from "@/lib/marina/fileType";
import { portalMaintenanceEnabled, MAINTENANCE_OFF_MESSAGE } from "@/lib/portalMaintenanceFlag";

// POST /api/portal/maintenance-add-photo  (multipart: residentId, requestId, file)
// Oct 24 (security run): the photo is uploaded here by the server — never from the browser — to
// the PRIVATE resident-documents bucket, under the park's own folder. file_url stores that path;
// the resident portal and the admin show it through short-lived signed links.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const residentId = String(form?.get("residentId") || "");
  const requestId = String(form?.get("requestId") || "");
  const file = form?.get("file");
  if (!residentId || !requestId || !file || typeof file === "string") {
    return NextResponse.json({ error: "residentId, requestId and a photo are required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: request } = await supabase
    .from("maintenance_requests")
    .select("id, company_id")
    .eq("id", requestId)
    .eq("resident_id", residentId)
    .maybeSingle();
  if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  // Oct 28 (per Mely): the park's switch — off by default.
  if (!(await portalMaintenanceEnabled(request.company_id))) {
    return NextResponse.json({ error: MAINTENANCE_OFF_MESSAGE, maintenanceRequestsDisabled: true }, { status: 403 });
  }

  const { count } = await supabase.from("maintenance_request_photos").select("id", { count: "exact", head: true }).eq("request_id", requestId);
  if ((count || 0) >= 10) return NextResponse.json({ error: "Up to 10 photos per request." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That photo is too large (max 10 MB)." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf, { pdf: false });
  if (!kind) return NextResponse.json({ error: "Only photos (JPG, PNG, WebP, HEIC)." }, { status: 400 });

  const path = `maintenance/${request.company_id}/${requestId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${kind.ext}`;
  const up = await supabase.storage.from("resident-documents").upload(path, buf, { contentType: kind.type });
  if (up.error) return NextResponse.json({ error: "Could not upload the photo." }, { status: 500 });

  const { error } = await supabase.from("maintenance_request_photos").insert({ request_id: requestId, file_url: path });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
