import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

export function readMarinaSessionCookie(req: Request): { memberId: string; companyId: string } | null {
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

// Oct 24 (security run): the signed cookie alone isn't enough — the boater must still exist in
// that marina. Removing a boater in the admin now signs them out everywhere right away.
export async function getMarinaSession(req: Request): Promise<{ memberId: string; companyId: string } | null> {
  const s = readMarinaSessionCookie(req);
  if (!s) return null;
  const { data, error } = await supabaseAdmin.from("marina_members").select("id").eq("id", s.memberId).eq("company_id", s.companyId).maybeSingle();
  return !error && data ? s : null;
}
