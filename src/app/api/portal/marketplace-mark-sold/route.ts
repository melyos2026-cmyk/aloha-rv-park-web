import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// POST /api/portal/marketplace-mark-sold
// Body: { residentId, listingId }
export async function POST(req: NextRequest) {
  const { residentId, listingId } = await req.json();

  if (!residentId || !listingId) {
    return NextResponse.json({ error: "residentId and listingId are required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { error } = await supabase
    .from("marketplace_listings")
    .update({ status: "sold" })
    .eq("id", listingId)
    .eq("resident_id", residentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
