import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 28 (per Mely): one branded shell for resident-facing emails sent from server code (bank payment
// returned, lot-conflict refund). Same look as the other resident emails in this repo
// (sendResidentNotificationEmail: park logo + name on the park's color; receipt footer: address ·
// Powered by MelyOS.io). Always the company's own name/logo — never hard-coded to one park.

export type EmailBrand = {
  companyName: string;
  logoUrl: string | null;
  color: string;
  address: string | null;
  portalUrl: string;
  isDemo: boolean;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The company's own website (companies.domain) + /residents/dashboard; Aloha's site otherwise.
function siteBase(domain: string | null | undefined): string {
  const d = String(domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!d || /\s/.test(d)) return "https://aloharvparkfl.com";
  return `https://${d}`;
}

export async function loadEmailBrand(companyId: string): Promise<EmailBrand | null> {
  let { data, error } = await supabaseAdmin
    .from("companies")
    .select("company_name, logo_url, primary_color, address, domain, is_demo")
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    // primary_color may not exist on every database — read without it, but KEEP is_demo (demo
    // companies must never get these emails). If is_demo is missing too, the domain rule still applies.
    const r = await supabaseAdmin.from("companies").select("company_name, logo_url, address, domain, is_demo").eq("id", companyId).maybeSingle();
    if (!r.error) data = r.data as any;
    else {
      const r2 = await supabaseAdmin.from("companies").select("company_name, logo_url, address, domain").eq("id", companyId).maybeSingle();
      if (r2.error) return null;
      data = r2.data as any;
    }
  }
  if (!data) return null;
  const domain = String((data as any).domain || "");
  return {
    companyName: (data as any).company_name || "Your RV Park",
    logoUrl: (data as any).logo_url || null,
    color: /^#[0-9a-f]{3,8}$/i.test(String((data as any).primary_color || "")) ? (data as any).primary_color : "#16a34a",
    address: (data as any).address || null,
    portalUrl: `${siteBase(domain)}/residents/dashboard`,
    // Same rule as demoPaymentBlock: is_demo, or a *.melyos.io demo address.
    isDemo: (data as any).is_demo === true || /(^|\.)melyos\.io$/i.test(domain),
  };
}

// bodyHtml is trusted HTML built by the caller (escape any user data with escapeHtml).
export function brandedEmailHtml(brand: EmailBrand, p: { title: string; bodyHtml: string; button?: { label: string; url: string } }): string {
  const name = escapeHtml(brand.companyName);
  return `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 560px; margin: 0 auto; background: #f9fafb; padding: 24px;">
    <div style="background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);">
      <div style="background: ${brand.color}; padding: 24px; text-align: center;">
        ${brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" style="max-height: 60px; margin-bottom: 8px;" />` : ""}
        <h1 style="color: #fff; margin: 0; font-size: 20px;">${name}</h1>
      </div>
      <div style="padding: 24px; color: #333; font-size: 14px;">
        <h2 style="color: #111; font-size: 18px; margin: 0 0 12px 0;">${escapeHtml(p.title)}</h2>
        ${p.bodyHtml}
        ${p.button ? `
        <div style="text-align: center; margin: 24px 0 8px 0;">
          <a href="${escapeHtml(p.button.url)}" style="display: inline-block; background: ${brand.color}; color: #fff; text-decoration: none; font-weight: bold; padding: 12px 24px; border-radius: 8px;">${escapeHtml(p.button.label)}</a>
        </div>` : ""}
      </div>
    </div>
    <p style="text-align:center; color:#888; font-size:12px; margin-top:16px;">
      ${name}${brand.address ? ` · ${escapeHtml(brand.address)}` : ""}
    </p>
    <p style="text-align:center; color:#bbb; font-size:10px; margin-top:4px;">
      Powered by MelyOS.io
    </p>
  </div>`;
}

// Sends through Resend's HTTP API (same as the other server emails). Returns true when accepted.
export async function sendBrandedEmail(brand: EmailBrand, to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${brand.companyName.replace(/[<>"]/g, "")} <noreply@aloharvparkfl.com>`, to, subject, html }),
    });
    if (!res.ok) console.error("sendBrandedEmail failed:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (e: any) {
    console.error("sendBrandedEmail error:", e?.message);
    return false;
  }
}

export const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
