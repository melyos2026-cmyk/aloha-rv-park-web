import crypto from "crypto";
import { NextResponse } from "next/server";

// Oct 20 (security review): shared guard for the /api/admin/*-notify and
// send-payment-reminder routes, which are called cross-domain by the admin
// app (melyos-builder). They used to answer anyone (no auth, CORS "*").
//
// 1. CORS: only the two real admin origins get an Access-Control-Allow-
//    Origin header, and a browser request from any OTHER origin is refused.
//    Server-to-server calls (no Origin header) are unaffected.
// 2. Admin session: melyos-builder signs admin tokens (lib/adminSession.ts)
//    with ADMIN_SESSION_SECRET. If that SAME secret is also set on this
//    site, these routes REQUIRE a valid token in the `x-admin-session`
//    header, scoped to the resident's company (master_admin allowed). If
//    it isn't set here yet, each route falls back to checking the request
//    against real data in the DB instead (see each route), so nothing
//    breaks before the env var is added.

export const ADMIN_ALLOWED_ORIGINS = new Set([
  "https://admin.melyos.io",
  "https://admin.aloharvparkfl.com",
  "https://adminmarinademo.melyos.io", // Oct 27: the demo office (contract second signature)
]);

export function adminCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-session",
    Vary: "Origin",
  };
  if (ADMIN_ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

// A browser request coming from some other website is refused outright.
export function rejectForeignOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin && !ADMIN_ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403, headers: adminCorsHeaders(req) });
  }
  return null;
}

export function adminSessionSecretConfigured(): boolean {
  return !!process.env.ADMIN_SESSION_SECRET;
}

type AdminSessionPayload = { adminId: string; companyId: string; role: string; expiresAt: number };

// Same token format/verification as melyos-builder's lib/adminSession.ts
// verifyAdminSession (base64url of `${adminId}.${companyId}.${role}.${expiresAt}.${hmacHex}`).
export function verifyAdminSessionToken(token: string | null | undefined): AdminSessionPayload | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || !token) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = decoded.split(".");
  if (parts.length !== 5) return null;
  const [adminId, companyId, role, expiresAtStr, signature] = parts;
  const payload = `${adminId}.${companyId}.${role}.${expiresAtStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  // Oct 29: melyos-builder may append the admin's session_version to the id part (`id~N`);
  // revocation itself is enforced on the admin app — here only the clean id is kept.
  return { adminId: adminId.split("~")[0], companyId, role, expiresAt };
}

// Returns null when the caller presented a valid admin session for this
// company, else a 401/403 response. Only meaningful when
// adminSessionSecretConfigured() is true.
export function requireAdminSessionForCompany(
  req: Request,
  companyId: string | null | undefined
): NextResponse | null {
  const session = verifyAdminSessionToken(req.headers.get("x-admin-session"));
  if (!session) {
    return NextResponse.json(
      { error: "Not authorized. Please sign in again." },
      { status: 401, headers: adminCorsHeaders(req) }
    );
  }
  if (session.role !== "master_admin" && (!companyId || session.companyId !== companyId)) {
    return NextResponse.json(
      { error: "Not authorized for this company." },
      { status: 403, headers: adminCorsHeaders(req) }
    );
  }
  return null;
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
