import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/upload-document
// Body: { residentId, fileName, fileDataBase64, contentType, documentType, relatedOccupantId? }
// Lets a resident record a document THEY uploaded (ID, insurance,
// registration, etc.) so the admin can view it if it's ever needed.
//
// Sep 25 (per Mely — full security audit, "no quiero huecos"): the file
// used to be uploaded directly from the browser to a PUBLIC bucket —
// its URL then worked forever for anyone who ever got hold of it, no
// login or expiry, since Storage access control can't recognize this
// app's own custom portal-session cookie (only Supabase Auth's real
// auth.uid(), which resident sessions don't use — same structural
// limitation already worked around everywhere else in this codebase by
// doing the write server-side with the Service Role Key instead). Now
// receives the raw file here, verifies the session first, and uploads
// it to a PRIVATE bucket — nothing about it is reachable without going
// back through this app's own auth (see document-url/route.ts for how
// it's actually viewed afterward, via a short-lived signed URL).
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

export async function POST(req: NextRequest) {
  const { residentId, fileName, fileDataBase64, contentType, documentType, relatedOccupantId } =
    await req.json();

  if (!residentId || !fileName || !fileDataBase64) {
    return NextResponse.json(
      { error: "residentId, fileName, and fileDataBase64 are required." },
      { status: 400 }
    );
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("company_id, full_name")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(fileDataBase64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid file data." }, { status: 400 });
  }
  if (fileBuffer.length === 0 || fileBuffer.length > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is empty or too large (15MB max)." }, { status: 400 });
  }

  // Aug 4 (per Mely): if this document is a Household Occupant's ID,
  // confirm the occupant actually belongs to this resident before linking
  // it — never trust an occupant id from the client alone.
  let confirmedOccupantId: string | null = null;
  if (relatedOccupantId) {
    const { data: occupant } = await supabase
      .from("resident_occupants")
      .select("id")
      .eq("id", relatedOccupantId)
      .eq("resident_id", residentId)
      .maybeSingle();
    confirmedOccupantId = occupant?.id || null;
  }

  const storagePath = `${residentId}/${Date.now()}-${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from("resident-documents")
    .upload(storagePath, fileBuffer, { contentType: contentType || "application/octet-stream" });

  if (uploadError) {
    return NextResponse.json({ error: "Could not upload file: " + uploadError.message }, { status: 500 });
  }

  // file_url now stores the PRIVATE bucket's storage path, not a public
  // URL — every consumer must go through document-url/route.ts (or the
  // admin equivalent) to get a fresh, short-lived signed URL rather than
  // treating this column as directly clickable.
  const { error } = await supabase.from("resident_documents").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    file_name: fileName,
    file_url: storagePath,
    document_type: documentType || "general",
    related_occupant_id: confirmedOccupantId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Let the admin know a resident uploaded a document, in case it's one
  // they were waiting on (insurance renewal, registration, etc.).
  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    resident_name: resident.full_name,
    update_type: "document_uploaded",
    message: `${resident.full_name} uploaded a document: ${fileName}.`,
  });

  return NextResponse.json({ success: true });
}
