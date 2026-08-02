import crypto from "crypto";
import { NextResponse } from "next/server";

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
const SECRET =
  process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const COOKIE_NAME = "portal_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function sign(payload: string): string {
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
export function getPortalSession(
  req: Request
): { residentId: string; companyId: string | null } | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;

  const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
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

  return { residentId, companyId: companyId || null };
}

// Convenience guard for portal API routes: verifies the session cookie
// exists AND matches the residentId the request is asking about. Returns
// null if OK to proceed, or a 401 NextResponse to return immediately.
export function requireMatchingSession(req: Request, requestedResidentId: string | null) {
  const session = getPortalSession(req);
  if (!session || !requestedResidentId || session.residentId !== requestedResidentId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  return null;
}
