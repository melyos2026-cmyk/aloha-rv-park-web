import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { isConfirmedDemo } from "@/lib/marina/host";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { hashLoginCode, newLoginCode } from "@/lib/marina/session";
import { escapeLikePattern, hasWildcardChars, sameEmail } from "@/lib/marina/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/marina/auth/request  { email }
// Sends a 6-digit sign-in code to a boater's email. The answer is always the
// same ("if that email is on file...") so the form can't be used to find out
// who is a customer. On demo marinas the code is shown on screen instead of
// emailed, because the demo accounts use made-up addresses.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Oct 26 (security review): per-device limit so one person can't request codes for many emails.
  if (await tooManyFromIp(req, `marina-code-request|${company.id}`, 20)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a while and try again." }, { status: 429 });
  }

  let email = "";
  try {
    email = String((await req.json()).email || "").trim().toLowerCase().slice(0, 160);
  } catch {}
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  // Oct 26 (security review): the code is only shown on screen on a CONFIRMED demo. If the demo
  // flag couldn't be read for a real marina, the code is emailed like normal (never revealed).
  const demo = isConfirmedDemo(company);
  const generic = { ok: true };

  // Oct 20 (security review): exact (case-insensitive) email match only —
  // wildcards in the typed email are escaped and the result re-checked.
  if (hasWildcardChars(email)) return NextResponse.json(generic);
  const { data: candidates } = await supabaseAdmin
    .from("marina_members")
    .select("id, full_name, email")
    .eq("company_id", company.id)
    .ilike("email", escapeLikePattern(email))
    .limit(10);
  const member = (candidates || []).find((m) => sameEmail(m.email, email)) || null;
  if (!member) return NextResponse.json(generic);

  // At most 3 codes per boater per 10 minutes.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("marina_login_codes")
    .select("id", { count: "exact", head: true })
    .eq("member_id", member.id)
    .gte("created_at", since);
  if ((count || 0) >= 3) return NextResponse.json(generic);

  const code = newLoginCode();
  const { error } = await supabaseAdmin.from("marina_login_codes").insert({
    company_id: company.id,
    member_id: member.id,
    code_hash: hashLoginCode(member.id, code),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "Could not send a code. Please try again." }, { status: 500 });

  if (demo) return NextResponse.json({ ok: true, demoCode: code });

  try {
    await resend.emails.send({
      from: `${company.company_name} <noreply@aloharvparkfl.com>`,
      to: email,
      subject: `${code} is your ${company.company_name} sign-in code`,
      html: `<div style="font-family:Arial,sans-serif;max-width:460px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 8px;">Your sign-in code</h2>
        <p style="color:#444;margin:0 0 16px;">Hi ${member.full_name.replace(/[<>&]/g, "")}, enter this code to sign in to your ${company.company_name} account.</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:0 0 16px;">${code}</p>
        <p style="color:#666;font-size:13px;margin:0;">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
      </div>`,
    });
  } catch (err: any) {
    console.error("marina login email failed:", err?.message);
  }
  return NextResponse.json(generic);
}
