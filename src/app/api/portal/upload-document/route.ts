import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/upload-document
// Body: { residentId, fileName, fileUrl, documentType, relatedOccupantId? }
// Lets a resident record a document THEY uploaded (ID, insurance,
// registration, etc.) so the admin can view it if it's ever needed —
// the actual file is uploaded to Storage client-side first (same
// "company-assets" bucket/pattern already used for marketplace photos),
// this just records the metadata server-side with a verified
// company_id (never trusted from the client).
export async function POST(req: NextRequest) {
  const { residentId, fileName, fileUrl, documentType, relatedOccupantId } = await req.json();

  if (!residentId || !fileName || !fileUrl) {
    return NextResponse.json(
      { error: "residentId, fileName, and fileUrl are required." },
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

  const { error } = await supabase.from("resident_documents").insert({
    company_id: resident.company_id,
    resident_id: residentId,
    file_name: fileName,
    file_url: fileUrl,
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
