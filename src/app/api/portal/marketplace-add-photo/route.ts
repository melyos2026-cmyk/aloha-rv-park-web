import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { sniff } from "@/lib/marina/fileType";

// POST /api/portal/marketplace-add-photo  (multipart: residentId, listingId, sortOrder, file)
// Oct 24 (security run): the server uploads the photo now (before, the browser uploaded it and
// sent back any URL it liked). Real type checked from the file's bytes, photos only, max 8.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const residentId = String(form?.get("residentId") || "");
  const listingId = String(form?.get("listingId") || "");
  const sortOrder = Math.max(0, Math.min(20, Number(form?.get("sortOrder")) || 0));
  const file = form?.get("file");
  if (!residentId || !listingId || !file || typeof file === "string") {
    return NextResponse.json({ error: "residentId, listingId and a photo are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("id, company_id")
    .eq("id", listingId)
    .eq("resident_id", residentId)
    .maybeSingle();
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });

  const { count } = await supabase.from("marketplace_listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listingId);
  if ((count || 0) >= 8) return NextResponse.json({ error: "Up to 8 photos per item." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That photo is too large (max 10 MB)." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf, { pdf: false });
  if (!kind) return NextResponse.json({ error: "Only photos (JPG, PNG, WebP, HEIC)." }, { status: 400 });

  const path = `marketplace/${listing.company_id}/${listingId}/${Date.now()}-${sortOrder}.${kind.ext}`;
  const up = await supabase.storage.from("company-assets").upload(path, buf, { contentType: kind.type });
  if (up.error) return NextResponse.json({ error: "Could not upload the photo." }, { status: 500 });
  const photoUrl = supabase.storage.from("company-assets").getPublicUrl(path).data.publicUrl;

  const { error } = await supabase.from("marketplace_listing_photos").insert({ listing_id: listingId, photo_url: photoUrl, sort_order: sortOrder });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
