import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/marketplace-add-photo
// Body: { residentId, listingId, photoUrl, sortOrder }
// Aug 5: the file itself is uploaded to Storage client-side first (same
// established pattern as resident_documents) — this route only records
// the metadata, after confirming the listing really belongs to this
// resident.
export async function POST(req: NextRequest) {
  const { residentId, listingId, photoUrl, sortOrder } = await req.json();

  if (!residentId || !listingId || !photoUrl) {
    return NextResponse.json(
      { error: "residentId, listingId, and photoUrl are required." },
      { status: 400 }
    );
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("id")
    .eq("id", listingId)
    .eq("resident_id", residentId)
    .maybeSingle();

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const { error } = await supabase.from("marketplace_listing_photos").insert({
    listing_id: listingId,
    photo_url: photoUrl,
    sort_order: sortOrder ?? 0,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
