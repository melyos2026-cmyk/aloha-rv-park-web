import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/lease-document-url?residentId=...&leaseId=...
// Sep 25 (per Mely — full security audit, "no quiero huecos"): lease PDFs
// now live in a private bucket, with only their storage path saved on
// the row. Generates a fresh, short-lived (5 min) signed URL after
// confirming the lease actually belongs to this resident's own session.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  const leaseId = req.nextUrl.searchParams.get("leaseId");

  if (!residentId || !leaseId) {
    return NextResponse.json({ error: "residentId and leaseId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: lease } = await supabase
    .from("resident_leases")
    .select("id, lease_document_url, resident_id")
    .eq("id", leaseId)
    .eq("resident_id", residentId)
    .maybeSingle();

  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }
  if (!lease.lease_document_url) {
    return NextResponse.json({ error: "This lease has no PDF on file." }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("resident-documents")
    .createSignedUrl(lease.lease_document_url, 60 * 5);

  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Could not generate a link for this file." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
