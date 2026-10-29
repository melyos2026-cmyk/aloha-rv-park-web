import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clientIp } from "@/lib/marina/ipLimit";

// Oct 29 (security review): guards for the public application flow (/apply).
//
// 1. Draft key: an application id (UUID) alone no longer lets anyone read or overwrite an
//    unpaid application. When an application is saved, the server creates a random secret,
//    keeps only its hash (inside form_draft_json._server_terms, a server-owned key) and gives the
//    applicant's browser the secret in an httpOnly cookie. Reading the draft back
//    (get-application-draft) or saving it again (submit-lease-application) needs that cookie, or
//    the invitation link's own token. Rows saved before this existed, with no key yet, stay
//    usable for a short grace period after they were created and get a key on their next save.
// 2. Lot holds: one applicant (same email, or same device) can hold at most one lot at a time.

export const SERVER_TERMS_KEY = "_server_terms";
export const LEGACY_DRAFT_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const COOKIE_PREFIX = "apd_";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
const SALT = process.env.MARINA_SESSION_SECRET || process.env.PORTAL_SESSION_SECRET || "melyos-rate";

const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export function draftCookieName(applicationId: string) {
  return `${COOKIE_PREFIX}${String(applicationId).replace(/[^0-9a-f-]/gi, "")}`;
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

/** The stored draft-key hash of an application's form_draft_json, if any. */
export function storedDraftKeyHash(formDraft: unknown): string | null {
  const t = formDraft && typeof formDraft === "object" ? (formDraft as any)[SERVER_TERMS_KEY] : null;
  return t && typeof t === "object" && typeof t.draft_key === "string" ? t.draft_key : null;
}

/**
 * May this request read/overwrite this application? True with the matching draft cookie, the
 * matching invitation token, or (rows with no key yet) within the grace period after creation.
 */
/** True when the request carries this application's matching draft cookie. */
export function draftCookieMatches(req: Request, app: { id: string; form_draft_json?: unknown }): boolean {
  const stored = storedDraftKeyHash(app.form_draft_json);
  const cookie = readCookie(req, draftCookieName(app.id));
  if (!stored || !cookie) return false;
  const a = Buffer.from(sha(cookie)), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function draftAccessAllowed(
  req: Request,
  app: { id: string; form_draft_json?: unknown; invite_token?: string | null; created_at?: string | null },
  inviteToken?: string | null
): boolean {
  if (inviteToken && app.invite_token && String(app.invite_token) === String(inviteToken)) return true;
  if (storedDraftKeyHash(app.form_draft_json)) return draftCookieMatches(req, app);
  const created = app.created_at ? new Date(app.created_at).getTime() : NaN;
  return Number.isFinite(created) && Date.now() - created < LEGACY_DRAFT_GRACE_MS;
}

/** A new secret for an application: returns the secret (cookie) and its hash (stored). */
export function newDraftKey() {
  const secret = crypto.randomBytes(32).toString("base64url");
  return { secret, hash: sha(secret) };
}

export function setDraftCookie(res: NextResponse, applicationId: string, secret: string) {
  res.cookies.set(draftCookieName(applicationId), secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api",
    maxAge: COOKIE_MAX_AGE,
  });
}

/** form_draft_json without the server-owned key, for sending back to the browser. */
export function publicDraft(formDraft: unknown) {
  if (!formDraft || typeof formDraft !== "object" || Array.isArray(formDraft)) return formDraft ?? null;
  const { [SERVER_TERMS_KEY]: _omit, ...rest } = formDraft as Record<string, unknown>;
  return rest;
}

// ---------------- lot holds ----------------

export function deviceHash(req: Request) {
  return crypto.createHmac("sha256", SALT).update(`apply-device|${clientIp(req)}`).digest("hex").slice(0, 32);
}

/**
 * Does this applicant (same email or same device) already hold ANOTHER lot at this park right now?
 * Never blocks when the check itself can't run (e.g. before the lot-hold SQL exists).
 */
export async function otherActiveHoldForApplicant(opts: { companyId: string; applicationId: string; email: string | null; device: string }) {
  const now = new Date().toISOString();
  const { data: lots, error } = await supabaseAdmin
    .from("rv_lots")
    .select("id, checkout_hold_ref, checkout_hold_until")
    .eq("company_id", opts.companyId)
    .gt("checkout_hold_until", now)
    .like("checkout_hold_ref", "application_%");
  if (error || !lots?.length) return false;
  const ids = [...new Set(lots.map((l: any) => String(l.checkout_hold_ref).slice("application_".length)))].filter(
    (id) => id && id !== opts.applicationId
  );
  if (!ids.length) return false;
  const { data: apps, error: appErr } = await supabaseAdmin
    .from("resident_applications")
    .select("id, email, form_draft_json, application_fee_paid")
    .in("id", ids.slice(0, 200));
  if (appErr || !apps) return false;
  const email = String(opts.email || "").trim().toLowerCase();
  return apps.some((a: any) => {
    if (a.application_fee_paid) return false;
    if (email && String(a.email || "").trim().toLowerCase() === email) return true;
    const t = a.form_draft_json && typeof a.form_draft_json === "object" ? a.form_draft_json[SERVER_TERMS_KEY] : null;
    return !!t && t.hold_device === opts.device;
  });
}

/** Remember which device opened this application's checkout (for the one-hold-per-device rule). */
export async function rememberHoldDevice(applicationId: string, device: string) {
  const { data } = await supabaseAdmin.from("resident_applications").select("form_draft_json").eq("id", applicationId).maybeSingle();
  if (!data) return;
  const draft = data.form_draft_json && typeof data.form_draft_json === "object" && !Array.isArray(data.form_draft_json) ? { ...data.form_draft_json } : {};
  const terms = draft[SERVER_TERMS_KEY] && typeof draft[SERVER_TERMS_KEY] === "object" ? { ...draft[SERVER_TERMS_KEY] } : {};
  if (terms.hold_device === device) return;
  terms.hold_device = device;
  draft[SERVER_TERMS_KEY] = terms;
  await supabaseAdmin.from("resident_applications").update({ form_draft_json: draft }).eq("id", applicationId).eq("application_fee_paid", false).then(() => null, () => null);
}
