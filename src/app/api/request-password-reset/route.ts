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

  const { data: residentMatches } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, email, portal_password, company_id, companies(company_name, domain, logo_url, primary_color)")
    .eq("email", email)
    .eq("portal_enabled", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const resident = residentMatches?.[0];

  // Always return success — don't reveal whether an email exists on file.
  if (!resident) {
    return NextResponse.json({ success: true });
  }

  const isFirstTimeSetup = !resident.portal_password;

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
  const brandColor = company?.primary_color || "#16a34a";
  const logoUrl = company?.logo_url;
  const resetLink = `https://${domain}/portal/reset-password?token=${token}`;
  const reportLink = `https://${domain}/api/report-suspicious-reset?token=${token}`;
  const loginLink = `https://${domain}/login`;

  // Shared branded shell — same header/card pattern as the
  // application-approved email so every resident-facing email looks
  // consistent (logo + brand color header, white card body).
  const emailShell = (bodyHtml: string) => `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 560px; margin: 0 auto; background: #f9fafb; padding: 24px;">
      <div style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
        <div style="background: ${brandColor}; padding: 24px; text-align: center;">
          ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 60px; margin-bottom: 8px;" />` : ""}
          <h1 style="color: #fff; margin: 0; font-size: 20px;">${companyName}</h1>
        </div>
        <div style="padding: 24px;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;

  const firstTimeSetupHtml = emailShell(`
    <h2 style="margin-top: 0; color: #111;">Your Resident Portal Is Ready! 🏡</h2>
    <p style="color: #333;">Hello,</p>
    <p style="color: #333;">
      An account has been created for you on the ${companyName} Resident Portal, where you can view your
      invoices, make payments, and manage your lease. Before you can log in, you need to create your password.
    </p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetLink}" style="background: ${brandColor}; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
        Create My Password
      </a>
    </div>
    <p style="color: #333;">This link expires in 30 minutes.</p>
    <p style="color: #333;">
      If it expires before you use it, just go to
      <a href="${loginLink}" style="color: ${brandColor};">${domain}/login</a> and click
      <strong>"Forgot Password"</strong> — that's the same way to set up your password the first time.
    </p>
    <p style="color: #999; font-size: 13px;">Welcome home,<br/>${companyName}</p>
    <p style="text-align:center; color:#ccc; font-size:10px; margin-top:16px;">Powered by MelyOS.io</p>
  `);

  const resetHtml = emailShell(`
    <h2 style="margin-top: 0; color: #111;">Reset Your Password</h2>
    <p style="color: #333;">You requested to reset your resident portal password.</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetLink}" style="background: ${brandColor}; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
        Reset Password
      </a>
    </div>
    <p style="color: #333;">This link expires in 30 minutes.</p>
    <p style="color: #333;">Didn't request this? <a href="${reportLink}" style="color: ${brandColor};">Click here to let ${companyName}'s office know</a> — this helps them see if someone else tried to access your account.</p>
    <p style="color: #999; font-size: 13px;">${companyName}</p>
    <p style="text-align:center; color:#ccc; font-size:10px; margin-top:16px;">Powered by MelyOS.io</p>
  `);

  const { error: sendError } = await resend.emails.send({
    from: `${companyName} <noreply@aloharvparkfl.com>`,
    to: resident.email,
    subject: isFirstTimeSetup
      ? `Your ${companyName} Resident Portal is ready — set up your password`
      : "Reset your resident portal password",
    html: isFirstTimeSetup ? firstTimeSetupHtml : resetHtml,
  });

  if (sendError) {
    console.error("Failed to send resident password/welcome email:", sendError);
    return NextResponse.json({ success: false, error: sendError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
