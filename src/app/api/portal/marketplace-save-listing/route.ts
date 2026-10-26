import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { moderateListing } from "@/lib/marketplaceModeration";

// POST /api/portal/marketplace-save-listing
// Body: { residentId, listingId? (edit) , title, description, price, category }
// Aug 5 (per Mely — final piece of the recurring RLS/session-verification
// pattern found across the whole portal): marketplace_listings previously
// wrote directly from the browser with the anon key and zero session
// check — any resident_id could be sent, and an edit could target ANY
// listing regardless of who owns it. This confirms the acting resident
// via session, and confirms an edit only ever touches a listing they
// actually own.
export async function POST(req: NextRequest) {
  const { residentId, listingId, title, description, price, category } = await req.json();

  if (!residentId || !title) {
    return NextResponse.json({ error: "residentId and title are required." }, { status: 400 });
  }

  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident?.company_id) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  // Oct 22 (per Mely): Mely checks the listing before it is saved or changed.
  const review = await moderateListing({ title, description, category, price: price ? Number(price) : null });
  if (!review.allowed) {
    return NextResponse.json({ error: review.reason, rejected: true }, { status: 422 });
  }
  // moderation_note is saved when the column exists (scripts/marina_37_marketplace.sql).
  const withNote = async (write: (extra: Record<string, any>) => PromiseLike<{ data?: any; error: any }>) => {
    const first = await write({ moderation_note: review.note });
    if (first.error && /moderation_note/i.test(String(first.error.message || ""))) return write({});
    return first;
  };

  if (listingId) {
    // Editing an existing listing — confirm it's really theirs first.
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id")
      .eq("id", listingId)
      .eq("resident_id", residentId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }

    const { error } = await withNote((extra) => supabase
      .from("marketplace_listings")
      .update({
        title: title.trim(),
        description: description?.trim() || null,
        price: price ? Number(price) : null,
        category,
        ...extra,
      })
      .eq("id", listingId)
      .eq("resident_id", residentId));

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, listingId });
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { data: newListing, error } = await withNote((extra) => supabase
    .from("marketplace_listings")
    .insert({
      company_id: resident.company_id,
      resident_id: residentId,
      title: title.trim(),
      description: description?.trim() || null,
      price: price ? Number(price) : null,
      category,
      status: "active",
      expires_at: expiresAt.toISOString(),
      ...extra,
    })
    .select("id")
    .single());

  if (error || !newListing) {
    return NextResponse.json({ error: error?.message || "Could not create listing." }, { status: 500 });
  }

  return NextResponse.json({ success: true, listingId: newListing.id });
}
