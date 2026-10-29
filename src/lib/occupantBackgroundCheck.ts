import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { createCheckrInvitation } from "@/lib/checkr";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";

// Oct 29 (live-money audit M5): a resident paid for one or more Household Occupants' background
// checks. Moved out of stripe-webhook so the daily reconcile can retry invitations.
//  - The FEE is marked paid on its own (only occupants still unpaid flip), right away — even when the
//    Checkr invitation fails or the park hasn't set its Checkr state yet. The invitation is a
//    separate step, retried on Stripe's redelivery and by the daily reconcile
//    (/api/cron/lot-payment-reconcile → retryOccupantInvitations).
//  - An occupant that was ALREADY paid by another checkout = a duplicate payment → System Health
//    (refund it); never invited twice.
//  - park_share_amount is what the park really received for that occupant (metadata.park_shares
//    from the checkout: $10 first / $5 additional, never more than the fee), not the whole fee.
// Returns "retry" when a database write failed (the webhook answers 500 so Stripe sends it again).

const MARKERS = "occupant_bgc";
const paidMarker = (occupantId: string, sessionId: string) => `occ_bgc_paid:${occupantId}:${sessionId}`;
const invitedMarker = (occupantId: string) => `occ_bgc_invited:${occupantId}`;
const PARK_SHARE_FIRST = 10.0;
const PARK_SHARE_ADDITIONAL = 5.0;

async function markerExists(id: string) {
  const { data } = await supabase.from("stripe_processed_events").select("status").eq("event_id", id).eq("source", MARKERS).maybeSingle();
  return !!data;
}
async function setMarker(id: string) {
  await claimStripeEvent(id, MARKERS);
  await finishStripeEvent(id, MARKERS, true);
}

async function alertOnce(companyId: string, ref: string, issueType: string, message: string) {
  const { data } = await supabase.from("system_health_issues").select("id").eq("company_id", companyId).eq("issue_type", issueType).like("message", `%${ref}%`).limit(1);
  if (data && data.length > 0) return;
  await logSystemHealthIssue({ companyId, issueType, source: "stripe_webhook", message });
}

function parseShares(raw: string | undefined | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of String(raw || "").split(";")) {
    const [id, amt] = part.split(":");
    const n = Number(amt);
    if (id && Number.isFinite(n) && n >= 0) out.set(id, Math.round(n * 100) / 100);
  }
  return out;
}

export async function handleOccupantBackgroundCheckPaid(session: Stripe.Checkout.Session): Promise<"retry" | void> {
  const occupantIds = String(session.metadata?.occupant_ids || "").split(",").filter(Boolean);
  const residentId = session.metadata?.resident_id || null;
  const amount = ((session.amount_total || 0) / 100).toFixed(2);

  const { data: resident } = residentId
    ? await supabase.from("resident_accounts").select("full_name, email, company_id").eq("id", residentId).maybeSingle()
    : { data: null as any };
  const companyId: string | null = session.metadata?.company_id || resident?.company_id || null;

  if (occupantIds.length === 0) {
    if (companyId) await alertOnce(companyId, session.id, "occupant_bgc_payment_review",
      `A household-occupant background check payment of $${amount} arrived with no occupants on it, so nothing was marked paid. Check it in Stripe and mark the occupant(s) by hand or refund it. Stripe session ${session.id}.`);
    return;
  }

  const { data: loaded, error } = await supabase
    .from("resident_occupants")
    .select("id, full_name, email, resident_id, company_id, background_check_fee_paid, checkr_candidate_id")
    .in("id", occupantIds);
  if (error) return "retry";
  const occupants = (loaded || []).filter((o: any) => !residentId || o.resident_id === residentId);
  if (occupants.length === 0) {
    if (companyId) await alertOnce(companyId, session.id, "occupant_bgc_payment_review",
      `${resident?.full_name || "A resident"} paid $${amount} for household-occupant background checks, but those occupants no longer exist on their account. Refund it or mark the right occupant by hand. Stripe session ${session.id}.`);
    return;
  }

  const shares = parseShares(session.metadata?.park_shares);
  const feeEach = occupantIds.length > 0 ? (session.amount_total || 0) / 100 / occupantIds.length : 0;

  // 1) The fee: mark paid (only occupants still unpaid flip, so two payments can't both "win").
  const ours: typeof occupants = [];
  const duplicates: typeof occupants = [];
  for (const [index, o] of occupants.entries()) {
    if (await markerExists(paidMarker(o.id, session.id))) { ours.push(o); continue; } // a retry of this payment
    const share = shares.has(o.id) ? shares.get(o.id)! : Math.min(index === 0 ? PARK_SHARE_FIRST : PARK_SHARE_ADDITIONAL, feeEach); // older checkouts
    const { data: flipped, error: upErr } = await supabase
      .from("resident_occupants")
      .update({ background_check_fee_paid: true, park_share_amount: share, park_share_paid_out: false })
      .eq("id", o.id)
      .or("background_check_fee_paid.is.null,background_check_fee_paid.eq.false")
      .select("id");
    if (upErr) return "retry";
    if ((flipped || []).length === 0) { duplicates.push(o); continue; }
    await setMarker(paidMarker(o.id, session.id));
    ours.push(o);
  }

  if (duplicates.length > 0 && companyId) {
    await alertOnce(companyId, `${session.id}:dup`, "rv_possible_duplicate_payment",
      `${resident?.full_name || "A resident"} paid $${amount} for background checks of ${duplicates.map((o) => o.full_name).join(", ")}, but ${duplicates.length === 1 ? "that occupant was" : "those occupants were"} ALREADY paid for by another payment. ${duplicates.length === occupants.length ? "This whole payment is a duplicate" : "Part of this payment is a duplicate"} — refund it from Shifts & Daily Close. Stripe session ${session.id}:dup.`);
  }

  if (ours.length > 0 && companyId) {
    await supabase.from("resident_update_notifications").insert({
      company_id: companyId, resident_id: residentId, resident_name: resident?.full_name || null,
      update_type: "occupant_background_check_paid",
      message: `${resident?.full_name || "A resident"} paid for a background check for: ${ours.map((o) => o.full_name).join(", ")}.`,
    }).then(() => null, () => null);
  }

  // 2) The Checkr invitation — its own step; a failure never undoes the payment (retried daily).
  await inviteOccupants(ours.map((o) => o.id), resident?.email || null);
}

/** Sends the Checkr invitation to paid occupants that don't have one yet. Never invites twice. */
export async function inviteOccupants(occupantIds: string[], fallbackEmail?: string | null): Promise<{ invited: number; failed: number }> {
  let invited = 0, failed = 0;
  if (occupantIds.length === 0) return { invited, failed };
  const { data: rows } = await supabase
    .from("resident_occupants")
    .select("id, full_name, email, resident_id, company_id, background_check_fee_paid, checkr_candidate_id")
    .in("id", occupantIds);
  const settingsCache = new Map<string, { state: string; pkg: string }>();
  for (const o of rows || []) {
    if (o.background_check_fee_paid !== true || o.checkr_candidate_id || !o.company_id) continue;
    if (await markerExists(invitedMarker(o.id))) {
      // Checkr already has an invitation for them but saving it failed earlier — never invite twice.
      await alertOnce(o.company_id, invitedMarker(o.id), "occupant_bgc_invitation_failed",
        `${o.full_name}'s background check invitation was created at Checkr, but it could not be saved on the occupant. Check Checkr for the candidate and update the occupant by hand (ref ${invitedMarker(o.id)}).`);
      continue;
    }
    if (!settingsCache.has(o.company_id)) {
      const { data: s } = await supabase.from("park_settings").select("checkr_work_location_state, checkr_default_package_slug").eq("company_id", o.company_id).maybeSingle();
      settingsCache.set(o.company_id, { state: s?.checkr_work_location_state || "", pkg: s?.checkr_default_package_slug || "basic_plus_criminal" });
    }
    const cfg = settingsCache.get(o.company_id)!;
    if (!cfg.state) {
      failed++;
      await alertOnce(o.company_id, `occ_bgc_nostate:${o.id}`, "occupant_bgc_invitation_failed",
        `${o.full_name}'s background check was PAID, but no Checkr invitation could be sent: the Checkr Work Location State is not set in Lease Defaults. Set it — the invitation is retried automatically every day (ref occ_bgc_nostate:${o.id}).`);
      continue;
    }
    let email = o.email || fallbackEmail || "";
    if (!email && o.resident_id) {
      const { data: r } = await supabase.from("resident_accounts").select("email").eq("id", o.resident_id).maybeSingle();
      email = r?.email || "";
    }
    try {
      const { candidateId } = await createCheckrInvitation({
        applicationId: "occupant", personKey: o.id, email, fullName: o.full_name, state: cfg.state, packageSlug: cfg.pkg,
      });
      await setMarker(invitedMarker(o.id));
      const { error } = await supabase.from("resident_occupants").update({
        checkr_candidate_id: candidateId, background_check_status: "invitation_sent",
        checkr_package_slug: cfg.pkg, checkr_invitation_sent_at: new Date().toISOString(),
      }).eq("id", o.id);
      if (error) {
        await logSystemHealthIssue({ companyId: o.company_id, issueType: "occupant_bgc_invitation_failed", source: "checkr",
          message: `${o.full_name}'s Checkr invitation was sent (candidate ${candidateId}) but could not be saved on the occupant (${error.message}). Set it by hand (ref ${invitedMarker(o.id)}).` });
      }
      invited++;
    } catch (err: any) {
      failed++;
      await alertOnce(o.company_id, `occ_bgc_invite:${o.id}`, "occupant_bgc_invitation_failed",
        `${o.full_name}'s background check was PAID, but the Checkr invitation failed (${String(err?.message || "error").slice(0, 200)}). It is retried automatically every day (ref occ_bgc_invite:${o.id}).`);
    }
  }
  return { invited, failed };
}

/**
 * Daily: occupants paid ONLINE (a payment marker from handleOccupantBackgroundCheckPaid, last 30 days)
 * that still have no Checkr invitation. Occupants marked paid any other way (by hand) are never
 * invited automatically — that would create a Checkr charge nobody asked for.
 */
export async function retryOccupantInvitations(): Promise<{ invited: number; failed: number; error?: string }> {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: markers, error: mErr } = await supabase
    .from("stripe_processed_events").select("event_id").eq("source", MARKERS).like("event_id", "occ_bgc_paid:%").gte("created_at", since).limit(500);
  if (mErr) return { invited: 0, failed: 0, error: mErr.message };
  const paidOnline = [...new Set((markers || []).map((m: any) => String(m.event_id).split(":")[1]).filter(Boolean))];
  if (paidOnline.length === 0) return { invited: 0, failed: 0 };
  const { data, error } = await supabase
    .from("resident_occupants")
    .select("id, background_check_status")
    .in("id", paidOnline)
    .eq("background_check_fee_paid", true)
    .is("checkr_candidate_id", null)
    .is("checkr_invitation_sent_at", null);
  if (error) return { invited: 0, failed: 0, error: error.message };
  const done = new Set(["Passed", "in_progress", "invitation_sent", "Needs Review", "Failed", "complete", "clear", "consider", "canceled", "Not Required", "Waived"]);
  const ids = (data || []).filter((o: any) => !done.has(String(o.background_check_status || ""))).map((o: any) => o.id);
  return inviteOccupants(ids);
}
