import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/documents?residentId=...
// SECURITY: this page previously read resident_leases/resident_documents
// directly with the anon key off a bare localStorage resident_id, no
// session check at all — same recurring gap found across this whole
// portal (payment-history, invoices, occupants/vehicles, fee-settings).
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: leases, error: leasesError } = await supabase
    .from("resident_leases")
    .select("id, lease_start, lease_end, monthly_rent, security_deposit, status, lease_document_url")
    .eq("resident_id", residentId)
    .order("created_at", { ascending: false });

  if (leasesError) {
    return NextResponse.json({ error: leasesError.message }, { status: 500 });
  }

  const { data: otherDocuments, error: docsError } = await supabase
    .from("resident_documents")
    .select("id, file_name, file_url, document_type")
    .eq("resident_id", residentId);

  if (docsError) {
    return NextResponse.json({ error: docsError.message }, { status: 500 });
  }

  // Oct 29 (security review): stored paths/old public URLs stay on the server — files open only
  // through /api/portal/document-url and /api/portal/lease-document-url (signed, 5 minutes).
  return NextResponse.json({
    leases: (leases || []).map((l: any) => ({ ...l, lease_document_url: l.lease_document_url ? "on_file" : null })),
    otherDocuments: (otherDocuments || []).map((d: any) => ({ ...d, file_url: "" })),
  });
}
