// Oct 19 (per Mely — Twilio A2P 10DLC campaign approval): shared SMS
// opt-in helpers. Server-only (uses the service role). The wording below is
// the exact text shown next to every "I agree to receive text messages"
// checkbox, and is saved with each consent as proof.
import { supabaseAdmin } from "@/lib/supabase-admin";
import { smsConsentWording } from "@/lib/smsConsentWording";

export const smsConsentText = smsConsentWording;

export function normalizeSmsPhone(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (v.startsWith("+") && d.length >= 8) return `+${d}`;
  return null;
}

export function requestIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
}

export async function recordSmsConsent(opts: {
  companyId: string;
  phone: string;
  name?: string | null;
  source: "public_form" | "application" | "portal" | "staff_verbal";
  parkName: string;
  ip?: string | null;
  residentId?: string | null;
}) {
  const phone = normalizeSmsPhone(opts.phone);
  if (!phone) return { ok: false as const, error: "Enter a valid mobile number." };
  const { error } = await supabaseAdmin.from("sms_consents").insert({
    company_id: opts.companyId,
    phone,
    name: opts.name || null,
    source: opts.source,
    consent_text: smsConsentText(opts.parkName),
    ip: opts.ip || null,
    resident_id: opts.residentId || null,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, phone };
}

export async function revokeSmsConsent(companyId: string, rawPhone: string) {
  const phone = normalizeSmsPhone(rawPhone);
  if (!phone) return;
  await supabaseAdmin
    .from("sms_consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("phone", phone)
    .is("revoked_at", null);
}

export async function hasSmsConsent(companyId: string, rawPhone: string | null | undefined) {
  const phone = normalizeSmsPhone(rawPhone);
  if (!phone) return false;
  const { data } = await supabaseAdmin
    .from("sms_consents")
    .select("id")
    .eq("company_id", companyId)
    .eq("phone", phone)
    .is("revoked_at", null)
    .limit(1);
  return !!data?.length;
}
