import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { moderateListing } from "@/lib/marketplaceModeration";
import { sniff } from "@/lib/marina/fileType";

// Oct 22 (per Mely): Marketplace for boaters — the same idea as the RV residents' Marketplace.
// Public GET lists this marina's active items (seller's first name only). Signed-in boaters
// post, edit, mark sold, repost or delete their OWN items; Mely reviews every post first.
// Everything is scoped to the marina of this website and the signed-in boater.

const CATEGORIES = ["Fishing gear", "Marine electronics", "Motors & parts", "Boats & kayaks", "Safety gear", "Dock & mooring", "Water sports", "Tools", "Furniture", "Free stuff", "Other"];
const BUCKET = "company-assets";
const nowIso = () => new Date().toISOString();

async function who(req: Request, needMember: boolean) {
  const company = await getMarinaForRequest(req);
  if (!company) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  if (needMember && !memberId) return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) } as const;
  return { company, memberId } as const;
}

const firstName = (n: string | null | undefined) => String(n || "").trim().split(/\s+/)[0] || "Boater";

export async function GET(req: Request) {
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  const w = await who(req, mine);
  if ("error" in w && w.error) return w.error;
  const { company, memberId } = w as any;
  let q = supabaseAdmin
    .from("marketplace_listings")
    .select("id, title, description, price, category, status, created_at, expires_at, member_id, posted_by_admin, marketplace_listing_photos(photo_url, sort_order), marina_members(full_name)")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(300);
  if (mine) q = q.eq("member_id", memberId);
  else q = q.eq("status", "active").or(`expires_at.is.null,expires_at.gt.${nowIso()}`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ listings: [], categories: CATEGORIES, ready: false });
  const listings = (data || []).map((l: any) => ({
    id: l.id, title: l.title, description: l.description, price: l.price, category: l.category,
    status: l.status, created_at: l.created_at, expires_at: l.expires_at,
    photos: (l.marketplace_listing_photos || []).sort((a: any, b: any) => a.sort_order - b.sort_order).map((p: any) => p.photo_url),
    seller: l.posted_by_admin ? "Marina office" : firstName(l.marina_members?.full_name),
  }));
  return NextResponse.json({ listings, categories: CATEGORIES, ready: true });
}

async function ownListing(companyId: string, memberId: string, id: string) {
  const { data } = await supabaseAdmin.from("marketplace_listings").select("id").eq("id", id).eq("company_id", companyId).eq("member_id", memberId).maybeSingle();
  return !!data;
}

export async function POST(req: Request) {
  const w = await who(req, true);
  if ("error" in w && w.error) return w.error;
  const { company, memberId } = w as any;

  // Photo upload (multipart): listingId + file
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const listingId = String(form?.get("listingId") || "");
    const file = form?.get("file");
    if (!listingId || !file || typeof file === "string") return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
    if (!(await ownListing(company.id, memberId, listingId))) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That photo is too large (max 10 MB)." }, { status: 400 });
    // Oct 24 (security run): real type from the file's bytes; photos only (no SVG, no PDF).
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniff(buf, { pdf: false });
    if (!kind) return NextResponse.json({ error: "Only photos can be added (JPG, PNG, WebP, HEIC)." }, { status: 400 });
    const { count } = await supabaseAdmin.from("marketplace_listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listingId);
    if ((count || 0) >= 8) return NextResponse.json({ error: "Up to 8 photos per item." }, { status: 400 });
    const path = `marketplace/${company.id}/${listingId}/${Date.now()}.${kind.ext}`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: kind.type });
    if (up.error) return NextResponse.json({ error: "Could not upload the photo." }, { status: 500 });
    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    await supabaseAdmin.from("marketplace_listing_photos").insert({ listing_id: listingId, photo_url: url, sort_order: count || 0 });
    return NextResponse.json({ ok: true, url });
  }

  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  const listingId = b.listingId ? String(b.listingId) : "";

  if (action === "save") {
    const title = String(b.title || "").trim().slice(0, 120);
    const description = String(b.description || "").trim().slice(0, 3000) || null;
    const category = CATEGORIES.includes(b.category) ? b.category : "Other";
    const price = b.price === "" || b.price == null ? null : Math.max(0, Math.min(10000000, Number(b.price) || 0));
    if (!title) return NextResponse.json({ error: "Write a title for your item." }, { status: 400 });
    if (listingId && !(await ownListing(company.id, memberId, listingId))) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    if (!listingId) {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await supabaseAdmin.from("marketplace_listings").select("id", { count: "exact", head: true }).eq("member_id", memberId).gte("created_at", since);
      if ((count || 0) >= 10) return NextResponse.json({ error: "You can post up to 10 items a day." }, { status: 429 });
    }
    const review = await moderateListing({ title, description, category, price });
    if (!review.allowed) return NextResponse.json({ error: review.reason, rejected: true }, { status: 422 });
    const fields = { title, description, category, price, moderation_note: review.note };
    if (listingId) {
      const { error } = await supabaseAdmin.from("marketplace_listings").update(fields).eq("id", listingId).eq("member_id", memberId).eq("company_id", company.id);
      if (error) return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
      return NextResponse.json({ ok: true, listingId });
    }
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabaseAdmin.from("marketplace_listings")
      .insert({ ...fields, company_id: company.id, member_id: memberId, status: "active", expires_at: expires, posted_by_admin: false })
      .select("id").single();
    if (error || !data) return NextResponse.json({ error: "The Marketplace is not ready yet. Please try again later." }, { status: 500 });
    return NextResponse.json({ ok: true, listingId: data.id });
  }

  if (!listingId || !(await ownListing(company.id, memberId, listingId))) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  const base = () => supabaseAdmin.from("marketplace_listings");
  let res: any;
  if (action === "sold") res = await base().update({ status: "sold" }).eq("id", listingId).eq("member_id", memberId);
  else if (action === "repost") res = await base().update({ status: "active", expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() }).eq("id", listingId).eq("member_id", memberId);
  else if (action === "delete") res = await base().delete().eq("id", listingId).eq("member_id", memberId);
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (res.error) return NextResponse.json({ error: "Could not update. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
