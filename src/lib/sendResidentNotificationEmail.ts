import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

// Sep 18 (per Mely — same helper as melyos-builder's copy, duplicated
// since these are separate codebases with no shared package): every
// resident-facing bell notification should ALSO email the resident.
// Best-effort — never blocks the caller if the email fails.
export async function sendResidentNotificationEmail(
  residentId: string,
  companyId: string,
  message: string,
  subject?: string
): Promise<void> {
  try {
    const [{ data: resident }, { data: company }] = await Promise.all([
      supabaseAdmin.from("resident_accounts").select("full_name, email").eq("id", residentId).maybeSingle(),
      supabaseAdmin.from("companies").select("company_name, logo_url, primary_color").eq("id", companyId).maybeSingle(),
    ]);

    if (!resident?.email) return;

    const brandColor = company?.primary_color || "#16a34a";
    const companyName = company?.company_name || "Your Park";

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 560px; margin: 0 auto; background: #f9fafb; padding: 24px;">
        <div style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
          <div style="background: ${brandColor}; padding: 24px; text-align: center;">
            ${company?.logo_url ? `<img src="${company.logo_url}" alt="${companyName}" style="max-height: 60px; margin-bottom: 8px;" />` : ""}
            <h1 style="color: #fff; margin: 0; font-size: 20px;">${companyName}</h1>
          </div>
          <div style="padding: 24px;">
            <p style="color: #333; margin: 0;">Hi ${resident.full_name || "there"},</p>
            <p style="color: #333;">${message.replace(/\n/g, "<br/>")}</p>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">Log in to your resident portal for details.</p>
          </div>
        </div>
      </div>
    `;

    const result = await resend.emails.send({
      from: `${companyName} <noreply@aloharvparkfl.com>`,
      to: resident.email,
      subject: subject || `New update from ${companyName}`,
      html,
    });

    if (result.error) {
      console.error("sendResidentNotificationEmail failed:", result.error);
    }
  } catch (err: any) {
    console.error("sendResidentNotificationEmail error:", err.message);
  }
}
