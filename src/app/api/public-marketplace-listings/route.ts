import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/public-marketplace-listings?company_id=...
//
// Aug 19 (public-site audit): the public marketplace page (no resident
// session — visitors browsing before they're residents) read
// marketplace_listings directly with the anon key, joined against
// resident_accounts(full_name) and rv_lots(lot_name) to show the seller's
// name/lot. marketplace_listings itself has its own narrow public policy
// (status='active' only, added earlier today), but resident_accounts and
// rv_lots do NOT have safe public policies for this — resident_accounts'
// only anon-accessible policy exposed every column with no company
// scoping, and rv_lots has no anon policy at all (meaning the lot name
// was silently never showing). Resolved server-side instead so neither
// table needs any public policy at all for this to work.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const { data: listings, error } = await supabase
    .from("marketplace_listings")
    .select("*, resident_accounts(full_name, rv_lots(lot_name)), marketplace_listing_photos(photo_url, sort_order)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ listings: listings || [] });
}
