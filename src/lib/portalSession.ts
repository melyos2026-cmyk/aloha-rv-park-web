import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getViewAsSession } from "@/lib/residentViewAs";
import { hasViewAsCookie, isSafeMethod, VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/viewAsCookie";

// Signed, httpOnly session cookie for the resident portal.
//
// Before this, portal API routes trusted a bare residentId sent by the
// client (originally read from localStorage) with no proof it belonged to
// whoever was actually making the request — anyone could open devtools,
// set a different resident's real UUID, and the server would happily act
// on their behalf (view invoices/documents, request a move-out, etc.).
// This signs the resident+company id server-side at login so a request
// can't be forged or swapped for a different resident's id.
//
// Uses PORTAL_SESSION_SECRET if set; falls back to the Supabase service
// role key (already a server-only secret) so this works without requiring
// an extra env var to be added in Vercel first. Recommend Mely add a
// dedicated PORTAL_SESSION_SECRET in Vercel when convenient, and this will
// pick it up automatically.
// Oct 29 (security): never an empty key — with no secret configured nothing is
// signed (login fails) and no cookie verifies (same rule as lib/marina/session.ts).
const SECRET = process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const COOKIE_NAME = "portal_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function sign(payload: string): string {
  if (!SECRET) throw new Error("PORTAL_SESSION_SECRET is not set.");
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function setPortalSessionCookie(
  res: NextResponse,
  residentId: string,
  companyId: string | null
) {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${residentId}.${companyId || ""}.${expiresAt}`;
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  res.cookies.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearPortalSessionCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

// Reads and verifies the session cookie from an incoming request.
// Returns { residentId, companyId } if valid and not expired, else null.
// Oct 26 (security review): now async — after the signature check it re-reads the resident row
// (one small query) so a resident who was deleted, had the portal turned off, whose portal access
// ended (home sold), or who moved to another company loses access right away, not when the
// 14-day cookie runs out.
// Oct 29 (per Mely — "View as resident"): a request carrying the read-only view-as cookie
// (lib/residentViewAs.ts) is answered as THAT resident for reads (GET/HEAD) and is never a
// session for anything else — a write returns null here (and 403 in requireMatchingSession),
// even if the same browser also holds a real resident cookie. `viewAs: true` marks it.
export async function getPortalSession(
  req: Request
): Promise<{ residentId: string; companyId: string | null; viewAs?: boolean } | null> {
  const cookieHeader = req.headers.get("cookie") || "";
  if (hasViewAsCookie(cookieHeader)) {
    if (!isSafeMethod(req.method)) return null; // read only: no write is ever authenticated
    const v = await getViewAsSession(req);
    if (v) return { residentId: v.residentId, companyId: v.companyId, viewAs: true };
    // an expired/ended view-as cookie is ignored for reads (falls back to the normal cookie)
  }
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  if (!SECRET) return null;
  let value = "";
  try {
    value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [residentId, companyId, expiresAtStr, signature] = parts;
  const payload = `${residentId}.${companyId}.${expiresAtStr}`;

  const expected = sign(payload);
  const validSig =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!validSig) return null;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  // Oct 26 (security review): the resident must still exist and still have portal access.
  // Oct 29 (security): "*" so password_changed_at is read when it exists (sec_auth.sql) without
  // breaking anything in a database where it doesn't yet.
  let { data: r, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("*")
    .eq("id", residentId)
    .maybeSingle();
  if (error) {
    // a column missing in one database must not lock every resident out — fall back to the basics
    ({ data: r, error } = await supabaseAdmin.from("resident_accounts").select("company_id, deleted_at").eq("id", residentId).maybeSingle() as any);
  }
  if (error || !r) return null;
  if (r.deleted_at || r.portal_enabled === false) return null;
  if (r.portal_access_ends_at && new Date(r.portal_access_ends_at) <= new Date()) return null;
  if (companyId && r.company_id !== companyId) return null;

  // Oct 29 (security): a cookie issued before the password was last changed or reset is refused
  // (a stolen/forgotten session ends when the resident changes the password). The cookie's issue
  // time is its expiry minus the fixed 14-day lifetime.
  const changedAt = (r as any).password_changed_at ? Date.parse((r as any).password_changed_at) : NaN;
  if (Number.isFinite(changedAt) && expiresAt - MAX_AGE_SECONDS * 1000 < changedAt) return null;

  return { residentId, companyId: companyId || null };
}

// Convenience guard for portal API routes: verifies the session cookie
// exists AND matches the residentId the request is asking about. Returns
// null if OK to proceed, or a 401 NextResponse to return immediately.
export async function requireMatchingSession(req: Request, requestedResidentId: string | null) {
  // Oct 29 ("View as resident"): every write from a view-as browser is refused, before anything else.
  const viewAsBlock = viewAsWriteBlock(req);
  if (viewAsBlock) return viewAsBlock;
  // Oct 26 (security review): async now (see getPortalSession) — callers must await it.
  const session = await getPortalSession(req);
  if (!session || !requestedResidentId || session.residentId !== requestedResidentId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return null;
}

/** 403 for any non-GET request made in read-only "View as resident" mode; null otherwise. */
export function viewAsWriteBlock(req: Request) {
  if (isSafeMethod(req.method) || !hasViewAsCookie(req.headers.get("cookie"))) return null;
  return NextResponse.json({ error: VIEW_AS_READ_ONLY_MESSAGE, viewAs: true }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
