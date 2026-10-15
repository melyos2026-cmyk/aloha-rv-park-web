import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { hashLoginCode, setMarinaSession } from "@/lib/marina/session";

// POST /api/marina/auth/verify  { email, code }
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let email = "";
  let code = "";
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase().slice(0, 160);
    code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  } catch {}
  const bad = NextResponse.json({ error: "That code is not valid. Request a new one." }, { status: 401 });
  if (!email || code.length !== 6) return bad;

  const { data: member } = await supabaseAdmin
    .from("marina_members")
    .select("id")
    .eq("company_id", company.id)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (!member) return bad;

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

  const expected = hashLoginCode(member.id, code);
  const same =
    expected.length === row.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(row.code_hash));

  if (!same) {
    await supabaseAdmin.from("marina_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return bad;
  }

  await supabaseAdmin.from("marina_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
  const res = NextResponse.json({ ok: true });
  setMarinaSession(res, member.id, company.id);
  return res;
}
