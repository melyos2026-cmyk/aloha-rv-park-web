import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/marketplace-toggle-saved
// Body: { residentId, listingId, saved: boolean }
export async function POST(req: NextRequest) {
  const { residentId, listingId, saved } = await req.json();

  if (!residentId || !listingId) {
    return NextResponse.json({ error: "residentId and listingId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  if (saved) {
    const { error } = await supabase
      .from("marketplace_saved_listings")
      .insert({ resident_id: residentId, listing_id: listingId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("marketplace_saved_listings")
      .delete()
      .eq("resident_id", residentId)
      .eq("listing_id", listingId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
