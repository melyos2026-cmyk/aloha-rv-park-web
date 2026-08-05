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

  const authError = requireMatchingSession(req, residentId);
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

  const result = (requests || []).map((r: any) => ({
    ...r,
    maintenance_request_photos: (photos || []).filter((p: any) => p.request_id === r.id),
    maintenance_request_notes: (notes || []).filter((n: any) => n.request_id === r.id),
  }));

  return NextResponse.json({ requests: result });
}
