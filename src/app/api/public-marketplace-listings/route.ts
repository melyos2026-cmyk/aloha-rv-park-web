import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { hostnameFromRequest } from "@/lib/marina/host";

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
  // Oct 26 (security review): the company is the one whose website this is (Host header), not a
  // ?company_id anyone can change to list another park's listings. The only caller is this site's
  // own /marketplace page (no embeds on other domains), so the param is now ignored.
  const host = hostnameFromRequest(req);
  const { data: hostCompany } = host
    ? await supabase.from("companies").select("id").in("domain", [host, `www.${host}`]).limit(1).maybeSingle()
    : { data: null };
  if (!hostCompany?.id) {
    return NextResponse.json({ listings: [] });
  }
  const companyId = hostCompany.id;

  const { data: listings, error } = await supabase
    .from("marketplace_listings")
    .select("*, resident_accounts(full_name), marketplace_listing_photos(photo_url, sort_order)")
    .eq("company_id", companyId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Oct 24 (security run): RV-park listings only (marina listings have their own page), and no
  // internal fields (boater id, moderation notes) in the public answer.
  const clean = (listings || [])
    .filter((l: any) => !l.member_id)
    .map(({ member_id, moderation_note, resident_id, resident_accounts, ...rest }: any) => ({
      ...rest,
      // Oct 29 (security review): the public sees the seller's first name + last initial only,
      // and never their lot number (where they live in the park).
      resident_accounts: { full_name: publicSellerName(resident_accounts?.full_name) },
    }));
  return NextResponse.json({ listings: clean });
}

// "Maria Lopez Rivera" → "Maria L."; a single name stays as is; empty → "Resident".
function publicSellerName(full: unknown): string {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Resident";
  if (parts.length === 1) return parts[0].slice(0, 40);
  return `${parts[0].slice(0, 40)} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
