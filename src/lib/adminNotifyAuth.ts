import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

type AdminSessionPayload = { adminId: string; companyId: string; role: string; expiresAt: number; sessionVersion: number | null };

// Same token format/verification as melyos-builder's lib/adminSession.ts
// decodeAdminSessionToken (base64url of `${adminId}.${companyId}.${role}.${expiresAt}.${hmacHex}`,
// where adminId may be `id~N` carrying admin_users.session_version).
// Signature + expiry only — use verifyAdminSessionLive for anything that acts on it.
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
  const [idPart, companyId, role, expiresAtStr, signature] = parts;
  const payload = `${idPart}.${companyId}.${role}.${expiresAtStr}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  // Oct 29: `id~N` = session_version N. No `~` (token issued before versions) = version 1,
  // the column's default — same rule as melyos-builder.
  let adminId = idPart;
  let sessionVersion: number | null = null;
  const tilde = idPart.indexOf("~");
  if (tilde >= 0) {
    adminId = idPart.slice(0, tilde);
    const v = Number(idPart.slice(tilde + 1));
    if (!Number.isInteger(v) || v < 1) return null;
    sessionVersion = v;
  }
  return { adminId, companyId, role, expiresAt, sessionVersion };
}

// ---- Oct 29 (security): live check, mirrors melyos-builder lib/adminSessionState.ts ----
// A validly signed token is only accepted while the admin's current admin_users row still
// matches it: row exists, not deleted/disabled, same company and role, and the token's
// session_version equals the row's (logout / password change / role change in the admin
// app bumps it). Cached ≤30s per server instance — the same window builder has across its
// own instances. If the session_version column doesn't exist yet, the version is skipped.
const SERVICE_ADMIN_IDS = new Set(["analytics"]); // builder's synthetic, server-signed identity
type AdminLiveState = { exists: boolean; active: boolean; companyId: string; role: string; version: number | null };
const ADMIN_STATE_TTL_MS = 30 * 1000;
const stateCache = new Map<string, { state: AdminLiveState; at: number }>();
const norm = (v: unknown) => (v == null || v === "null" || v === "undefined" ? "" : String(v));

function stateFromRow(u: any): AdminLiveState {
  if (!u) return { exists: false, active: false, companyId: "", role: "", version: null };
  const gone = !!u.deleted_at || u.is_active === false || u.active === false || u.disabled === true;
  const hasVersion = Object.prototype.hasOwnProperty.call(u, "session_version") && u.session_version != null;
  const v = hasVersion ? Number(u.session_version) : NaN;
  return {
    exists: true,
    active: !gone,
    companyId: u.company_id == null ? "" : String(u.company_id),
    role: u.role == null ? "" : String(u.role),
    version: Number.isInteger(v) && v > 0 ? v : null,
  };
}

function sessionMatchesState(s: AdminSessionPayload, st: AdminLiveState): boolean {
  if (SERVICE_ADMIN_IDS.has(s.adminId)) return true;
  if (!st.exists || !st.active) return false;
  if (norm(st.companyId) !== norm(s.companyId)) return false;
  if (norm(st.role) !== norm(s.role)) return false;
  if (st.version != null && (s.sessionVersion ?? 1) !== st.version) return false;
  return true;
}

async function loadAdminState(adminId: string): Promise<AdminLiveState | "error"> {
  try {
    const { data, error } = await supabaseAdmin.from("admin_users").select("*").eq("id", adminId).maybeSingle();
    if (error) {
      if ((error as any).code === "22P02") return stateFromRow(null); // not a uuid → no such admin
      console.error("admin session state lookup:", error.message);
      return "error";
    }
    const state = stateFromRow(data);
    if (stateCache.size > 5000) stateCache.clear();
    stateCache.set(adminId, { state, at: Date.now() });
    return state;
  } catch (e: any) {
    console.error("admin session state lookup:", e?.message || e);
    return "error";
  }
}

async function checkAdminSessionLive(s: AdminSessionPayload): Promise<"ok" | "revoked" | "error"> {
  if (SERVICE_ADMIN_IDS.has(s.adminId)) return "ok";
  const hit = stateCache.get(s.adminId);
  if (hit && Date.now() - hit.at <= ADMIN_STATE_TTL_MS && sessionMatchesState(s, hit.state)) return "ok";
  // no/expired cache, or it disagrees (may be stale): confirm with the database before refusing
  const state = await loadAdminState(s.adminId);
  if (state === "error") return "error";
  return sessionMatchesState(s, state) ? "ok" : "revoked";
}

/**
 * Signature + expiry + live database check. Returns the session or null.
 * failOpen (default false, like builder): when the database can't be reached, accept a
 * validly signed token instead of rejecting it. Every route here writes → keep it false.
 */
export async function verifyAdminSessionLive(
  token: string | null | undefined,
  opts: { failOpen?: boolean } = {}
): Promise<AdminSessionPayload | null> {
  const session = verifyAdminSessionToken(token);
  if (!session) return null;
  const r = await checkAdminSessionLive(session);
  if (r === "ok") return session;
  if (r === "error" && opts.failOpen) return session;
  return null;
}

// Returns null when the caller presented a valid, still-live admin session for this
// company, else a 401/403 response. Only meaningful when adminSessionSecretConfigured()
// is true. Fails closed on a database error (these routes all write/send).
export async function requireAdminSessionForCompany(
  req: Request,
  companyId: string | null | undefined
): Promise<NextResponse | null> {
  const session = await verifyAdminSessionLive(req.headers.get("x-admin-session"));
  if (!session) {
    return NextResponse.json(
      { error: "Not authorized. Please sign in again.", sessionRevoked: true },
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
