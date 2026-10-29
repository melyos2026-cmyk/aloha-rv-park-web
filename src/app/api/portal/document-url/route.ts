import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { signStoredFile } from "@/lib/storedFile";

// GET /api/portal/document-url?residentId=...&documentId=...
// Sep 25 (per Mely — full security audit, "no quiero huecos"): documents
// now live in a PRIVATE bucket (resident-documents) with only their
// storage path saved on the row, not a permanent public URL. This is
// the only way to actually view one — generates a fresh signed URL,
// valid for 5 minutes, after confirming the requester really is the
// resident who owns this document (or, once implemented, an admin for
// the same company).
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  const documentId = req.nextUrl.searchParams.get("documentId");

  if (!residentId || !documentId) {
    return NextResponse.json({ error: "residentId and documentId are required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: doc } = await supabase
    .from("resident_documents")
    .select("id, file_url, resident_id")
    .eq("id", documentId)
    .eq("resident_id", residentId)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // Oct 29: also opens older rows that still hold a (now private) lease-documents URL.
  const url = await signStoredFile(doc.file_url, 60 * 5);
  if (!url) {
    return NextResponse.json({ error: "Could not generate a link for this file." }, { status: 500 });
  }

  return NextResponse.json({ url });
}
