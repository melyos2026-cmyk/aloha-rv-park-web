import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { VIEW_AS_COOKIE } from "@/lib/viewAsCookie";

// Oct 29 (per Mely — "View as resident", read only).
//
// A park manager (melyos-builder → Resident Accounts → "View as resident") asks the admin server
// for a one-time handoff link (/api/admin/resident-view-as). That server stores ONLY the sha256
// of a random token in resident_view_sessions (admin, company, resident, 30-minute expiry) and
// opens https://<park domain>/residents/view-as?t=<token> in a new tab. Here:
//
//  1. exchangeViewAsToken — the link is used ONCE (a single conditional UPDATE … WHERE used_at IS
//     NULL), within 5 minutes of being created, on the park's own website. It returns a NEW random
//     secret for the browser cookie `resident_view_as` (its hash is stored as cookie_hash), so the
//     link in the URL/history is worthless after the exchange.
//  2. getViewAsSession — every request re-reads the row (not ended, not expired), the resident
//     (still exists, same company) and the admin (still active, same company or master_admin,
//     still a manager, same session_version as when the link was made — signing out / password
//     change in the admin ends the view).
//  3. The mode is READ ONLY: any non-GET request carrying the cookie is refused (src/proxy.ts for
//     every /api route, and again in lib/portalSession.ts for every portal route). Stripe is never
//     reached (all payment/autopay routes are POST; GET /api/verify-payment-session refuses too).
//
// The resident's own `portal_session` cookie is never issued or touched by this.

export const VIEW_AS_EXCHANGE_WINDOW_MS = 5 * 60 * 1000;
const DEMO_OFFICE_EMAIL = "demo.office@marinademo.melyos.io"; // same as melyos-builder lib/demoOffice.ts

export const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export type ViewAsSession = {
  id: string;
  residentId: string;
  companyId: string;
  adminId: string;
  residentName: string;
  expiresAt: string;
};

const isDemoCo = (c: any) => !!c && (c.is_demo === true || /(^|\.)melyos\.io$/i.test(String(c.domain || "")));
const adminGone = (u: any) => !u || !!u.deleted_at || u.is_active === false || u.active === false || u.disabled === true;

/** Re-checks a stored view session against the database. Returns the session, or null. */
async function validateRow(row: any): Promise<ViewAsSession | null> {
  if (!row || row.ended_at || !row.used_at) return null;
  if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) return null;

  const [{ data: resident }, { data: admin }] = await Promise.all([
    supabaseAdmin.from("resident_accounts").select("id, company_id, full_name, deleted_at").eq("id", row.resident_id).maybeSingle(),
    supabaseAdmin.from("admin_users").select("*").eq("id", row.admin_id).maybeSingle(),
  ]);
  if (!resident || resident.deleted_at || resident.company_id !== row.company_id) return null;
  if (adminGone(admin)) return null;
  const a: any = admin;
  const isMaster = a.role === "master_admin";
  if (!isMaster && a.company_id !== row.company_id) return null;
  // signed out / password changed / role changed in the admin since the link was made → ended
  if (row.admin_session_version != null && a.session_version != null && Number(a.session_version) !== Number(row.admin_session_version)) return null;
  const isDemoOffice = String(a.email || "").toLowerCase() === DEMO_OFFICE_EMAIL;
  if (isDemoOffice) {
    // the public demo office may only ever look at a demo company's residents
    const { data: co } = await supabaseAdmin.from("companies").select("is_demo, domain").eq("id", row.company_id).maybeSingle();
    if (!isDemoCo(co)) return null;
  } else if (!isMaster && a.can_manage_money !== true) {
    return null;
  }
  return {
    id: row.id,
    residentId: row.resident_id,
    companyId: row.company_id,
    adminId: row.admin_id,
    residentName: resident.full_name || "Resident",
    expiresAt: row.expires_at,
  };
}

function readCookie(req: Request): string | null {
  const match = (req.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${VIEW_AS_COOKIE}=`));
  if (!match) return null;
  try {
    const v = decodeURIComponent(match.slice(VIEW_AS_COOKIE.length + 1));
    return /^[A-Za-z0-9_-]{40,100}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** The valid view-as session this request carries, or null. Never throws. */
export async function getViewAsSession(req: Request): Promise<ViewAsSession | null> {
  const secret = readCookie(req);
  if (!secret) return null;
  try {
    const { data: row, error } = await supabaseAdmin
      .from("resident_view_sessions")
      .select("*")
      .eq("cookie_hash", sha256Hex(secret))
      .maybeSingle();
    if (error || !row) return null;
    return await validateRow(row);
  } catch {
    return null;
  }
}

export type ExchangeResult =
  | { ok: true; session: ViewAsSession; cookieSecret: string }
  | { ok: false; error: string };

/** Uses a one-time handoff token (single use, 5-minute window, this website's company only). */
export async function exchangeViewAsToken(token: string, ip: string | null, hostCompanyId: string | null): Promise<ExchangeResult> {
  // Review: fixed error codes only (the ready page maps them to text — no free text in the URL).
  const fail = (error: "invalid" | "other_park" | "not_allowed" = "invalid") => ({ ok: false as const, error });
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return fail();
  const cookieSecret = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  try {
    // ONE conditional update = single use, even if the link is opened twice at the same moment.
    const { data: row, error } = await supabaseAdmin
      .from("resident_view_sessions")
      .update({ used_at: now.toISOString(), used_ip: ip, cookie_hash: sha256Hex(cookieSecret) })
      .eq("token_hash", sha256Hex(token))
      .is("used_at", null)
      .is("ended_at", null)
      .gt("expires_at", now.toISOString())
      .gt("created_at", new Date(now.getTime() - VIEW_AS_EXCHANGE_WINDOW_MS).toISOString())
      .select("*")
      .maybeSingle();
    if (error || !row) return fail();

    // A park's link only works on that park's own website.
    // Review: an unknown host (preview URL, etc.) is refused too.
    if (!hostCompanyId || hostCompanyId !== row.company_id) {
      await endViewAsSession(row.id);
      return fail("other_park");
    }
    const session = await validateRow(row);
    if (!session) {
      await endViewAsSession(row.id);
      return fail("not_allowed");
    }
    return { ok: true, session, cookieSecret };
  } catch {
    return fail();
  }
}

export async function endViewAsSession(id: string) {
  try {
    await supabaseAdmin.from("resident_view_sessions").update({ ended_at: new Date().toISOString() }).eq("id", id).is("ended_at", null);
  } catch {
    /* best effort */
  }
}

export function setViewAsCookie(res: NextResponse, cookieSecret: string, expiresAt: string) {
  res.cookies.set(VIEW_AS_COOKIE, cookieSecret, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearViewAsCookie(res: NextResponse) {
  res.cookies.set(VIEW_AS_COOKIE, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
}

export async function companyIdForHost(host: string): Promise<string | null> {
  if (!host) return null;
  const { data } = await supabaseAdmin.from("companies").select("id").in("domain", [host, `www.${host}`]).limit(1).maybeSingle();
  return data?.id || null;
}
