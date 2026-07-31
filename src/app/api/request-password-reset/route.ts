import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const requestIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  const { data: resident } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, email, company_id, companies(company_name, domain)")
    .eq("email", email)
    .eq("portal_enabled", true)
    .is("deleted_at", null)
    .single();

  // Always return success — don't reveal whether an email exists on file.
  if (!resident) {
    return NextResponse.json({ success: true });
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();

  await supabaseAdmin.from("resident_password_resets").insert({
    resident_id: resident.id,
    email: resident.email,
    token,
    expires_at: expiresAt,
    request_ip: requestIp,
  });

  const company = (resident as any).companies;
  const domain = company?.domain || "aloharvparkfl.com";
  const companyName = company?.company_name || "Aloha RV Park";
  const resetLink = `https://${domain}/portal/reset-password?token=${token}`;
  const reportLink = `https://${domain}/api/report-suspicious-reset?token=${token}`;

  await resend.emails.send({
    from: `${companyName} <noreply@aloharvparkfl.com>`,
    to: resident.email,
    subject: "Reset your resident portal password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Reset Your Password</h2>
        <p>You requested to reset your resident portal password.</p>
        <p>
          <a href="${resetLink}" style="background:#000;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px;">
            Reset Password
          </a>
        </p>
        <p>This link expires in 30 minutes.</p>
        <p>Didn't request this? <a href="${reportLink}">Click here to let ${companyName}'s office know</a> — this helps them see if someone else tried to access your account.</p>
      </div>
    `,
  });

  return NextResponse.json({ success: true });
}
