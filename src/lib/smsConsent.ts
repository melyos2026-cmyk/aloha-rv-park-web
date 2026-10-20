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

// Oct 20 (security review): US/NANP numbers only (+1 and 10 digits, area
// code can't start with 0/1). Used for the PUBLIC opt-in form and for the
// confirmation text itself, so the open form can't be used to make this
// account send texts to premium/international numbers (toll fraud).
// normalizeSmsPhone above is left as-is for the existing lookups.
export function normalizeUsSmsPhone(raw: string | null | undefined): string | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (d[0] === "0" || d[0] === "1") return null;
  if (v.startsWith("+") && !v.replace(/\s/g, "").startsWith("+1")) return null;
  return `+1${d}`;
}

// Oct 20 (security review): true if ANY consent row for this phone (any
// park) was created in the last 24 hours — used so the public form can't
// be used to text the same number over and over.
async function consentRecordedRecently(phone: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("sms_consents")
    .select("id")
    .eq("phone", phone)
    .gte("created_at", since)
    .limit(1);
  return !!data?.length;
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

// Oct 19 (per Mely — matches the "opt-in message" registered with the
// carriers for the A2P campaign): one confirmation text right after someone
// newly agrees. Uses Twilio's REST API directly (no extra package). Silently
// skipped when the TWILIO_* env vars aren't set on this site, and never
// blocks the consent itself. Texts only deliver once the campaign is approved.
export async function sendSmsOptInConfirmation(rawPhone: string, parkName: string) {
  // Oct 20 (security review): confirmation texts only ever go to US numbers.
  const to = normalizeUsSmsPhone(rawPhone);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!to || !sid || !keySid || !keySecret || !from) return;
  const body =
    `${parkName}: You're signed up for account text alerts (invoices, payment notices, application and ` +
    `reservation messages). Msg frequency varies. Msg&data rates may apply. Reply HELP for help, STOP to opt out.`;
  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${keySid}:${keySecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
  } catch (e: any) {
    console.error("sms opt-in confirmation failed:", e?.message);
  }
}

/** Records consent and, only if this phone wasn't already opted in, sends the confirmation text. */
export async function recordSmsConsentAndConfirm(opts: Parameters<typeof recordSmsConsent>[0]) {
  const already = await hasSmsConsent(opts.companyId, opts.phone);
  // Oct 20 (security review): also skip the confirmation text if this
  // phone already had a consent recorded in the last 24h (any park) — e.g.
  // opt in, opt out, opt in again in a loop. Checked BEFORE the new row is
  // inserted below, so a genuine first-time sign-up still gets its text.
  const normalized = normalizeSmsPhone(opts.phone);
  const recent = normalized ? await consentRecordedRecently(normalized) : false;
  const result = await recordSmsConsent(opts);
  if (result.ok && !already && !recent) await sendSmsOptInConfirmation(opts.phone, opts.parkName);
  return result;
}
