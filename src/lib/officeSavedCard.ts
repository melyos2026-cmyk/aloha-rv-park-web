// Nov 24 (per Mely — Johnston Springs): the office can SAVE a resident's card (only when the resident
// agreed, and only for parks that turned it on) and later charge it for a real invoice of that
// resident. Server-only.
//
// Safety:
//  - The card number never touches MelyOS: it is typed in the processor's secure form; we keep only
//    the processor's reference + "Visa •••• 4417".
//  - Requests from the MelyOS admin are signed (HMAC with the shared service key) — a guest link or a
//    stranger can't ask to save a card or charge one.
//  - Every save is written to saved_card_consents (who recorded the resident's OK, when, which card).
//  - Every office charge goes through the same claim/charge/finish path as card autopay
//    (src/lib/rvCardAutopay.ts): one invoice, Pending only, never twice.
import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/** Same function in melyos-builder lib/officeSig.ts — keep both in sync. */
export function officeSig(parts: (string | number | null | undefined)[]) {
  return crypto.createHmac("sha256", KEY()).update(`melyos-office:${parts.map((p) => String(p ?? "")).join("|")}`).digest("hex");
}
export function officeSigOk(sig: unknown, parts: (string | number | null | undefined)[]) {
  if (!KEY() || typeof sig !== "string" || sig.length !== 64) return false;
  const want = officeSig(parts);
  try { return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(want, "hex")); } catch { return false; }
}

/** Is "save the card at the office" turned on for this park? (Fee Settings; default OFF) */
export async function officeSaveCardOn(companyId: string | null | undefined) {
  if (!companyId) return false;
  const { data, error } = await supabase.from("company_fee_settings").select("office_save_card").eq("company_id", companyId).maybeSingle();
  return !error && (data as any)?.office_save_card === true;
}

/** The resident's processor customer (created once, like the portal's card save). */
export async function ensureResidentCustomer(stripe: Stripe, residentId: string) {
  const { data: r } = await supabase.from("resident_accounts").select("id, full_name, email, stripe_customer_id").eq("id", residentId).maybeSingle();
  if (!r) return null;
  if (r.stripe_customer_id) return r.stripe_customer_id as string;
  const c = await stripe.customers.create({ name: r.full_name || undefined, email: r.email || undefined, metadata: { resident_id: r.id } });
  await supabase.from("resident_accounts").update({ stripe_customer_id: c.id }).eq("id", r.id);
  return c.id;
}

export const cardLabel = (pm: Stripe.PaymentMethod | null | undefined) =>
  pm?.card ? `${pm.card.brand.charAt(0).toUpperCase()}${pm.card.brand.slice(1)} •••• ${pm.card.last4}` : "Saved card";

/** After an office checkout that asked to save the card: keep it on the resident's account. Safe to run twice. */
export async function saveOfficeCardFromSession(stripe: Stripe, session: Stripe.Checkout.Session) {
  const m = session.metadata || {};
  if (m.save_card !== "1" || !m.resident_id || session.payment_status !== "paid") return;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!piId) return;
  const pi = await stripe.paymentIntents.retrieve(piId).catch(() => null);
  const pmId = typeof pi?.payment_method === "string" ? pi.payment_method : pi?.payment_method?.id;
  if (!pmId) return;
  const pm = await stripe.paymentMethods.retrieve(pmId).catch(() => null);
  const pmCustomer = typeof pm?.customer === "string" ? pm.customer : pm?.customer?.id;
  const { data: r } = await supabase.from("resident_accounts").select("id, company_id, full_name, stripe_customer_id, office_card_pm_id").eq("id", m.resident_id).maybeSingle();
  if (!r || !pm || pm.type !== "card" || !pmCustomer || pmCustomer !== r.stripe_customer_id) return;
  if (r.office_card_pm_id === pmId) return; // already saved (webhook retry)
  const label = cardLabel(pm);
  const { error } = await supabase.from("resident_accounts").update({ office_card_pm_id: pmId, office_card_label: label, office_card_saved_at: new Date().toISOString() }).eq("id", r.id);
  if (error) { console.error("saveOfficeCard:", error.message); return; }
  await supabase.from("saved_card_consents").insert({
    company_id: r.company_id, resident_id: r.id, card_label: label, payment_method_ref: pmId, source: "office",
    recorded_by: m.saved_by || "Office", consent_text: "Resident agreed at the office to save this card for future payments to the park.",
  }).then(() => null, () => null);
  await supabase.from("resident_update_notifications").insert({
    company_id: r.company_id, resident_id: r.id, resident_name: r.full_name || null, update_type: "card_saved",
    message: `${m.saved_by || "The office"} saved ${r.full_name || "a resident"}'s card (${label}) for future payments — the resident agreed.`,
  }).then(() => null, () => null);
}
