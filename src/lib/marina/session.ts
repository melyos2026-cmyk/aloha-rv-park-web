import crypto from "crypto";
import { NextResponse } from "next/server";

// Signed, httpOnly sign-in cookie for boaters (marina customers). Same idea
// as the resident portal cookie but a separate cookie name and a separate
// signing context, so one can never be used as the other.
const SECRET =
  process.env.MARINA_SESSION_SECRET ||
  process.env.PORTAL_SESSION_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const COOKIE_NAME = "marina_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function sign(payload: string): string {
  // Oct 24 (security run): never sign with an empty key (anyone could forge a sign-in).
  if (!SECRET) throw new Error("MARINA_SESSION_SECRET is not set.");
  return crypto.createHmac("sha256", SECRET).update(`marina:${payload}`).digest("hex");
}

export function setMarinaSession(res: NextResponse, memberId: string, companyId: string) {
  const expiresAt = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${memberId}.${companyId}.${expiresAt}`;
  res.cookies.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearMarinaSession(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export function getMarinaSession(req: Request): { memberId: string; companyId: string } | null {
  const cookie = (req.headers.get("cookie") || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!cookie || !SECRET) return null;
  let raw = "";
  try { raw = decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)); } catch { return null; }
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [memberId, companyId, expiresAtStr, signature] = parts;
  const expected = sign(`${memberId}.${companyId}.${expiresAtStr}`);
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return { memberId, companyId };
}

// One-time sign-in codes are stored hashed, never in clear text.
export function hashLoginCode(memberId: string, code: string): string {
  if (!SECRET) throw new Error("MARINA_SESSION_SECRET is not set.");
  return crypto.createHmac("sha256", SECRET).update(`code:${memberId}:${code}`).digest("hex");
}

export function newLoginCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}
