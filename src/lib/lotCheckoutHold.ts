import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import { brandedEmailHtml, escapeHtml, loadEmailBrand, money, sendBrandedEmail } from "@/lib/residentEmailLayout";

// Oct 28 (per Mely — "¿cómo evitar que 2 personas paguen por el mismo lote al mismo tiempo?"),
// the "Ticketmaster" way:
//  1) HOLD: when someone opens checkout for a specific lot, the lot is held for them atomically
//     (rv_lots.checkout_hold_ref / _until / _session_id — scratchpad lot_checkout_hold.sql). The Stripe
//     session expires after 31 min (Stripe's minimum is 30), the hold after 36 — it always outlasts the
//     session. Anyone else gets a 409. The SAME application opening checkout again reuses/extends its
//     own hold (and its older, still-open Stripe session is closed).
//  2) AUTHORIZE, THEN CAPTURE: lot checkouts authorize the card only (capture_method "manual"). The
//     webhook assigns the lot to the payer first; only if that worked is the card captured. If the lot
//     went to someone else, the authorization is CANCELED (no Stripe fee; the money is released on the
//     card), the payer is emailed and System Health is told. No automatic refunds.
// Works before the SQL is run: the hold is then skipped (the paid-holder checks still apply).

export const LOT_SESSION_MINUTES = 31;
export const LOT_HOLD_MINUTES = 36;
export const LOT_HELD_MESSAGE =
  "Someone is checking out this lot right now — please choose another lot or try again in 30 minutes.";
export const LOT_TAKEN_MESSAGE = "This lot is on hold — please choose a different lot and try again.";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export const lotSessionExpiresAt = () => Math.floor(Date.now() / 1000) + LOT_SESSION_MINUTES * 60;
// "application_<uuid>" — one ref per application, shared by its application-fee and RTO-deposit checkouts.
export const applicationHoldRef = (applicationId: string) => `application_${applicationId}`;

function missingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /checkout_hold_/.test(String(error.message || ""));
}

export type HoldResult =
  | { ok: true; supported: boolean; previousSessionId: string | null; newlyTaken: boolean }
  | { ok: false; reason: "held" | "error"; message: string };

// Atomic: ONE conditional UPDATE — succeeds only if the lot has no hold, an expired hold, or a hold by
// this same ref. Postgres re-checks the WHERE after a concurrent update commits, so two people can never
// both get it.
export async function takeLotCheckoutHold(lotId: string, companyId: string, ref: string): Promise<HoldResult> {
  const { data: before, error: readErr } = await supabase
    .from("rv_lots")
    .select("checkout_hold_ref, checkout_hold_until, checkout_hold_session_id")
    .eq("id", lotId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (readErr) {
    if (missingColumn(readErr)) return { ok: true, supported: false, previousSessionId: null, newlyTaken: false };
    return { ok: false, reason: "error", message: "Could not check this lot right now. Please try again." };
  }
  if (!before) {
    // Oct 28 (review): the lot isn't in this company (or is gone). Checkout used to work in this case —
    // don't block it; continue without a hold (the webhook's paid-holder check still applies).
    console.warn(`takeLotCheckoutHold: lot ${lotId} not found for company ${companyId} — continuing without a hold`);
    return { ok: true, supported: false, previousSessionId: null, newlyTaken: false };
  }

  const now = new Date();
  const until = new Date(now.getTime() + LOT_HOLD_MINUTES * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("rv_lots")
    .update({ checkout_hold_ref: ref, checkout_hold_until: until })
    .eq("id", lotId)
    .eq("company_id", companyId)
    .or(`checkout_hold_ref.is.null,checkout_hold_until.is.null,checkout_hold_until.lt.${now.toISOString()},checkout_hold_ref.eq.${ref}`)
    .select("id");
  if (error) {
    if (missingColumn(error)) return { ok: true, supported: false, previousSessionId: null, newlyTaken: false };
    return { ok: false, reason: "error", message: "Could not hold this lot right now. Please try again." };
  }
  if (!rows || rows.length === 0) return { ok: false, reason: "held", message: LOT_HELD_MESSAGE };
  const mine = before.checkout_hold_ref === ref && before.checkout_hold_until && new Date(before.checkout_hold_until) > now;
  return { ok: true, supported: true, previousSessionId: mine ? before.checkout_hold_session_id || null : null, newlyTaken: !mine };
}

export async function attachSessionToHold(lotId: string, ref: string, sessionId: string) {
  await supabase.from("rv_lots").update({ checkout_hold_session_id: sessionId }).eq("id", lotId).eq("checkout_hold_ref", ref).then(() => null, () => null);
}

// Releases the hold only if it is still this ref's (and, when given, this session's) — an older
// session expiring never frees the hold of a newer checkout by the same person.
export async function releaseLotCheckoutHold(lotId: string, ref: string, sessionId?: string | null) {
  let q = supabase
    .from("rv_lots")
    .update({ checkout_hold_ref: null, checkout_hold_until: null, checkout_hold_session_id: null })
    .eq("id", lotId)
    .eq("checkout_hold_ref", ref);
  if (sessionId) q = q.eq("checkout_hold_session_id", sessionId);
  await q.then(() => null, () => null);
}

// Closes an older, still-open Stripe session of the same person FOR THE SAME CHARGE (best-effort), so
// they can't pay twice. (Their application-fee and RTO-deposit checkouts share one hold — neither
// closes the other.)
export async function expireOlderSession(sessionId: string | null, keepSessionId: string, type: string) {
  if (!stripe || !sessionId || sessionId === keepSessionId) return;
  const old = await stripe.checkout.sessions.retrieve(sessionId).catch(() => null);
  if (!old || old.status !== "open" || old.metadata?.type !== type) return;
  // Tagged first, so the webhook's checkout.session.expired doesn't report it as a failed payment.
  await stripe.checkout.sessions.update(sessionId, { metadata: { ...(old.metadata || {}), superseded: "1" } }).catch(() => null);
  await stripe.checkout.sessions.expire(sessionId).catch(() => null);
}

// Another live application already paid for this lot (application fee or RTO deposit): Pending,
// not archived, same company. The current resident of a lot being sold (C11-style) has an Approved
// application, so it never counts.
export async function otherPaidHolder(companyId: string, lotId: string, applicationId: string) {
  const { data, error } = await supabase
    .from("resident_applications")
    .select("id, full_name, archived, application_fee_paid, rent_to_own_deposit_paid")
    .eq("company_id", companyId)
    .eq("space_id", lotId)
    .eq("status", "Pending")
    .neq("id", applicationId)
    .or("application_fee_paid.eq.true,rent_to_own_deposit_paid.eq.true");
  if (error) return { error: error.message, holder: null as null | { id: string; full_name: string | null } };
  const holder = (data || []).find((a: any) => a.archived !== true) || null;
  return { error: null as string | null, holder: holder as null | { id: string; full_name: string | null } };
}

// Same rule the application-fee checkout has always used: the lot is free if it is available or
// for sale, or a resident-owned sale/RTO listing exists for it (occupied by the seller until it closes).
export async function lotOpenForApplication(lotId: string, companyId: string) {
  const { data: lot } = await supabase
    .from("rv_lots")
    .select("status, lot_name, company_id, daily_rate")
    .eq("id", lotId)
    .eq("company_id", companyId)
    .maybeSingle();
  let hasActiveSaleListing = false;
  if (lot?.lot_name && lot.company_id) {
    const { data: companyRow } = await supabase.from("companies").select("park_id").eq("id", lot.company_id).maybeSingle();
    if (companyRow?.park_id) {
      const { data: listing } = await supabase
        .from("real_estate_listings")
        .select("id")
        .eq("park_id", companyRow.park_id)
        .eq("lot_key", lot.lot_name)
        .eq("sold", false)
        .eq("seller_type", "resident")
        .in("type", ["sale", "rent-to-own"])
        .maybeSingle();
      hasActiveSaleListing = !!listing;
    }
  }
  const open = !lot || lot.status === "available" || lot.status === "for_sale" || hasActiveSaleListing;
  return { lot, open, hasActiveSaleListing };
}

export function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
}

// Cancels an authorization (idempotent: an already-canceled one is fine). Tags it first so a
// redelivered event knows it was canceled for a lot conflict (and still sends the notices once).
export async function cancelAuthorization(piId: string, tag: "lot_conflict" | "duplicate"): Promise<"canceled" | "captured" | "error"> {
  if (!stripe) return "error";
  try {
    let pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.status === "canceled") return "canceled";
    if (pi.status === "succeeded") return "captured";
    await stripe.paymentIntents.update(piId, { metadata: { lot_cancel_reason: tag } });
    pi = await stripe.paymentIntents.cancel(piId, { cancellation_reason: tag === "duplicate" ? "duplicate" : "abandoned" }, { idempotencyKey: `lotcancel-${piId}` });
    return pi.status === "canceled" ? "canceled" : "error";
  } catch (e: any) {
    console.error("cancelAuthorization:", piId, e?.message);
    const again = await stripe.paymentIntents.retrieve(piId).catch(() => null);
    return again?.status === "canceled" ? "canceled" : again?.status === "succeeded" ? "captured" : "error";
  }
}

// Captures an authorization once. "retry" = Stripe didn't answer / still capturable (try again later);
// "gone" = the authorization can no longer be captured (canceled/expired).
export async function captureAuthorization(piId: string): Promise<{ result: "captured" | "retry" | "gone"; pi: Stripe.PaymentIntent | null }> {
  if (!stripe) return { result: "retry", pi: null };
  try {
    const pi = await stripe.paymentIntents.capture(piId, {}, { idempotencyKey: `lotcapture-${piId}` });
    return { result: pi.status === "succeeded" ? "captured" : "retry", pi };
  } catch (e: any) {
    const pi = await stripe.paymentIntents.retrieve(piId).catch(() => null);
    if (pi?.status === "succeeded") return { result: "captured", pi };
    if (!pi || pi.status === "requires_capture" || pi.status === "processing") return { result: "retry", pi };
    console.error("captureAuthorization:", piId, e?.message);
    return { result: "gone", pi };
  }
}

// The lot went to someone else: System Health (once per session), office bell notice and a polite
// email to the payer (once per session). Called again on a redelivery — each part is deduped.
export async function notifyLotConflict(p: {
  session: Stripe.Checkout.Session;
  companyId: string;
  payerName: string | null;
  payerEmail: string | null;
  lotName: string | null;
  kind: "application fee" | "Rent-to-Own deposit";
  authorizationCanceled: boolean; // true: card authorization released, nothing charged
}) {
  const amount = (p.session.amount_total || 0) / 100;
  const lot = p.lotName ? `Lot ${p.lotName}` : "the selected lot";
  const { data: logged } = await supabase
    .from("system_health_issues")
    .select("id")
    .eq("company_id", p.companyId)
    .eq("issue_type", "lot_checkout_conflict")
    .like("message", `%${p.session.id}%`)
    .limit(1);
  if (!logged || logged.length === 0) {
    await logSystemHealthIssue({
      companyId: p.companyId,
      issueType: "lot_checkout_conflict",
      source: "stripe_webhook",
      message: p.authorizationCanceled
        ? `${p.payerName || "An applicant"} completed checkout for the ${p.kind} ($${amount.toFixed(2)}) on ${lot}, but the lot had already gone to another paid applicant. Their card was only authorized, so the authorization was CANCELED — nothing was charged and no Stripe fee applies. They were emailed; contact them to offer another lot or the waitlist. Stripe session ${p.session.id}.`
        : `${p.payerName || "An applicant"} PAID the ${p.kind} ($${amount.toFixed(2)}) on ${lot}, but the lot had already gone to another paid applicant. The payment was NOT refunded automatically — contact them to offer another lot or the waitlist, or refund it from Daily Close if they prefer. Stripe session ${p.session.id}.`,
    });
    await supabase.from("resident_update_notifications").insert({
      company_id: p.companyId,
      resident_name: p.payerName,
      update_type: "application_lot_conflict",
      message: p.authorizationCanceled
        ? `${p.payerName || "An applicant"} tried to pay the ${p.kind} for ${lot}, but it was just taken by another applicant. Their card was NOT charged. Please contact them to choose a different lot.`
        : `${p.payerName || "An applicant"} paid the ${p.kind} ($${amount.toFixed(2)}) for ${lot}, but it was just taken by another applicant. Please contact them to choose a different lot or the waitlist (not refunded automatically).`,
    }).then(() => null, () => null);
  }

  if (!p.payerEmail || !p.authorizationCanceled) return; // bank/captured cases: the office reaches out
  const marker = `lot_conflict_email:${p.session.id}`;
  if ((await claimStripeEvent(marker, "lot_checkout")) === "duplicate") return;
  const brand = await loadEmailBrand(p.companyId);
  if (!brand || brand.isDemo) { await finishStripeEvent(marker, "lot_checkout", true); return; }
  const html = brandedEmailHtml(brand, {
    title: `${p.lotName ? `Lot ${p.lotName}` : "Your selected lot"} is no longer available`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">Hi ${escapeHtml(p.payerName || "there")},</p>
      <p style="margin:0 0 12px 0;">Thank you for your ${escapeHtml(p.kind)} payment. Unfortunately, ${escapeHtml(lot)} was reserved by another applicant moments before your payment was completed.</p>
      <p style="margin:0 0 12px 0;"><strong>Your card was not charged.</strong> The ${money(amount)} was only authorized, and that authorization has been released. Depending on your bank, the pending amount may still show for a few days before it disappears.</p>
      <p style="margin:0 0 12px 0;">We'd love to help you find another spot — please choose a different lot, or contact the office and we'll gladly help you with another lot or our waitlist.</p>
      <p style="margin:0;">We're sorry for the inconvenience.</p>`,
    button: { label: "Choose another lot", url: brand.portalUrl.replace(/\/residents\/dashboard$/, "/apply") },
  });
  const ok = await sendBrandedEmail(brand, p.payerEmail, `${p.lotName ? `Lot ${p.lotName}` : "Your lot"} is no longer available — your card was not charged`, html);
  await finishStripeEvent(marker, "lot_checkout", ok);
}
