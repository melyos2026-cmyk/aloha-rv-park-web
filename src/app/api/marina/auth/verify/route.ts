import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { hashLoginCode, setMarinaSession } from "@/lib/marina/session";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { isConfirmedDemo } from "@/lib/marina/host";
import { escapeLikePattern, hasWildcardChars, sameEmail } from "@/lib/marina/email";

// POST /api/marina/auth/verify  { email, code }
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Oct 26 (security review): per-device limit on code guesses.
  if (await tooManyFromIp(req, `marina-code-verify|${company.id}`, 30)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a while and try again." }, { status: 429 });
  }

  let email = "";
  let code = "";
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase().slice(0, 160);
    code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  } catch {}
  const bad = NextResponse.json({ error: "That code is not valid. Request a new one." }, { status: 401 });
  if (!email || code.length !== 6) return bad;

  // Oct 20 (security review): exact (case-insensitive) email match only —
  // wildcards in the typed email are escaped and the result re-checked.
  if (hasWildcardChars(email)) return bad;
  const { data: candidates } = await supabaseAdmin
    .from("marina_members")
    .select("id, email")
    .eq("company_id", company.id)
    .ilike("email", escapeLikePattern(email))
    .limit(10);
  const member = (candidates || []).find((m) => sameEmail(m.email, email)) || null;
  if (!member) return bad;

  // Oct 26 (security review): per-boater cap of 10 wrong codes per 24 hours, across every code issued
  // (each code allows 5 tries, and new codes can be requested). Counted from the attempts already
  // stored on marina_login_codes: wrong tries = all attempts minus the ones that signed in.
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("marina_login_codes")
    .select("attempts, used_at")
    .eq("member_id", member.id)
    .gte("created_at", dayAgo)
    .limit(500);
  const failed = (recent || []).reduce((n, r: any) => n + Math.max(0, (r.attempts || 0) - (r.used_at ? 1 : 0)), 0);
  // (Not on a confirmed demo: there the code is shown on screen anyway, and the shared demo boater
  // must not be locked out for every prospect by one person typing wrong codes.)
  if (failed >= 10 && !isConfirmedDemo(company)) {
    return NextResponse.json({ error: "Too many wrong codes. Please try again tomorrow or contact the marina office." }, { status: 429 });
  }

  const { data: row } = await supabaseAdmin
    .from("marina_login_codes")
    .select("id, code_hash, attempts")
    .eq("member_id", member.id)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row || row.attempts >= 5) return bad;

  // Oct 24 (security run): use up one attempt BEFORE checking the code, and only if nobody else
  // used it at the same moment (compare-and-swap). Many requests sent at once can no longer all
  // get a free guess — each one has to win its own attempt slot, and there are only 5.
  const { data: slot } = await supabaseAdmin
    .from("marina_login_codes")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .is("used_at", null)
    .select("id");
  if (!slot?.length) return bad;

  const expected = hashLoginCode(member.id, code);
  const same =
    expected.length === row.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(row.code_hash));
  if (!same) return bad;

  // A code works once: only the request that marks it used gets signed in.
  const { data: used } = await supabaseAdmin
    .from("marina_login_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (!used?.length) return bad;
  const res = NextResponse.json({ ok: true });
  setMarinaSession(res, member.id, company.id);
  return res;
}
