import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/maintenance-requests?residentId=...
// Aug 5 (per Mely's full-site audit): /residents/maintenance previously
// read maintenance_requests directly with the anon key off a bare
// localStorage resident_id, zero session verification — same gap already
// fixed on Invoices/Payment History/Electric History. Also used the
// embedded-relationship syntax (maintenance_request_photos(*),
// maintenance_request_notes(*)) — the same pattern that has silently
// broken other screens before (missing FK registration in PostgREST's
// schema cache). Fixed both at once.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: requests, error } = await supabase
    .from("maintenance_requests")
    .select("*")
    .eq("resident_id", residentId)
    .neq("status", "Cancelled")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const requestIds = (requests || []).map((r) => r.id);
  const { data: photos } = requestIds.length
    ? await supabase.from("maintenance_request_photos").select("*").in("request_id", requestIds)
    : { data: [] as any[] };
  const { data: notes } = requestIds.length
    ? await supabase.from("maintenance_request_notes").select("*").in("request_id", requestIds)
    : { data: [] as any[] };

  // Oct 24 (security run): photos in private storage are shown through 10-minute signed links.
  // Older photos were in the (now private) maintenance-photos bucket by public link — sign those too.
  const photoRows: any[] = photos || [];
  const OLD = "/storage/v1/object/public/maintenance-photos/";
  const groups: Record<string, any[]> = { "resident-documents": [], "maintenance-photos": [] };
  for (const p of photoRows) {
    if (!p.file_url) continue;
    if (!/^https?:\/\//.test(p.file_url)) groups["resident-documents"].push([p, p.file_url]);
    else if (p.file_url.includes(OLD)) groups["maintenance-photos"].push([p, decodeURIComponent(p.file_url.split(OLD)[1].split("?")[0])]);
  }
  for (const [bucket, list] of Object.entries(groups)) {
    if (!list.length) continue;
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(list.map((x: any) => x[1]), 600);
    const byPath = new Map((signed || []).map((x: any) => [x.path, x.signedUrl]));
    for (const [p, path] of list as any[]) p.file_url = byPath.get(path) || null;
  }
  const result = (requests || []).map((r: any) => ({
    ...r,
    maintenance_request_photos: (photos || []).filter((p: any) => p.request_id === r.id),
    maintenance_request_notes: (notes || []).filter((n: any) => n.request_id === r.id),
  }));

  return NextResponse.json({ requests: result });
}
