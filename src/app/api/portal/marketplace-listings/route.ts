import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/marketplace-listings?residentId=...&companyId=...
//
// Aug 19 (per Mely — found while checking for other tables with the same
// wide-open anon policy already fixed for real_estate_listings/sales):
// marketplace_listings/marketplace_saved_listings/marketplace_listing_photos
// had a single ALL-command anon policy with no restriction whatsoever —
// EVERY write already went through protected /api/portal/marketplace-*
// routes, but browsing (reading listings + which ones you've saved) still
// read directly with the anon key, relying entirely on that open policy.
// This is the missing read-side counterpart, so the policy can be dropped
// without breaking the marketplace page.
//
// Aug 19, later same day (public-site audit): companyId is now optional —
// residents/marketplace/page.tsx used to look its own company_id up via a
// direct anon-key read of resident_accounts before calling this route,
// relying on a policy ("resident_accounts_anon_login_select") far broader
// than it needed (full row, any column, any company) — resolved here
// server-side instead so that policy can be narrowed/dropped.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  let companyId = req.nextUrl.searchParams.get("companyId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  if (!companyId) {
    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("company_id")
      .eq("id", residentId)
      .maybeSingle();
    companyId = resident?.company_id || null;
    if (!companyId) {
      return NextResponse.json({ error: "Could not resolve company for this resident." }, { status: 404 });
    }
  }

  const { data: listings, error: listingsError } = await supabase
    .from("marketplace_listings")
    .select("*, resident_accounts(full_name, rv_lots(lot_name)), marketplace_listing_photos(photo_url, sort_order)")
    .eq("company_id", companyId)
    .neq("status", "removed")
    .order("created_at", { ascending: false });

  if (listingsError) {
    return NextResponse.json({ error: listingsError.message }, { status: 500 });
  }

  const { data: saved } = await supabase
    .from("marketplace_saved_listings")
    .select("listing_id")
    .eq("resident_id", residentId);

  return NextResponse.json({
    listings: listings || [],
    savedIds: (saved || []).map((s) => s.listing_id),
    companyId,
  });
}
