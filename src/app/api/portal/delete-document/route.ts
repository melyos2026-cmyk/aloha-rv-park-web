import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/delete-document
// Body: { residentId, documentId }
// Lets a resident remove one of their own uploaded documents (e.g. if
// they picked the wrong file by mistake). Only ever deletes from
// resident_documents (the "Other Documents" list) — never touches a
// lease document, since those live on resident_leases and aren't
// something a resident can remove themselves.
export async function POST(req: NextRequest) {
  const { residentId, documentId } = await req.json();

  if (!residentId || !documentId) {
    return NextResponse.json(
      { error: "residentId and documentId are required." },
      { status: 400 }
    );
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  // SECURITY: confirm this document actually belongs to the session's own
  // resident before deleting it — otherwise anyone could remove a
  // different resident's document just by knowing/guessing its id.
  const { data: existing } = await supabase
    .from("resident_documents")
    .select("id, resident_id")
    .eq("id", documentId)
    .maybeSingle();

  if (!existing || existing.resident_id !== residentId) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const { error } = await supabase.from("resident_documents").delete().eq("id", documentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
