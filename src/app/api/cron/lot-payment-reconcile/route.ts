import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { handleApplicationFeePaid, handleRentToOwnDepositPaid } from "@/lib/lotPaymentHandlers";

export const dynamic = "force-dynamic";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// GET /api/cron/lot-payment-reconcile — daily.
// Oct 28 (per Mely — review of the authorize-then-capture lot checkouts): lot payments (application
// fee, Rent-to-Own deposit) only AUTHORIZE the card; the webhook captures after giving the lot to the
// payer. If the webhook never finished (Stripe gave up retrying, a capture kept failing, the function
// died), this finds it:
//  1) authorizations still waiting (requires_capture) for 2+ hours → run the SAME idempotent handler
//     the webhook uses (captures if the lot is still theirs; cancels only on a clear lot conflict);
//     if it still isn't captured afterwards → System Health for the office (never canceled "just in case");
//  2) CAPTURED lot payments of the last 7 days → the same handler again, so a payment captured at
//     Stripe whose finish never ran (function died after the capture, or captured in Stripe by hand)
//     still gets marked paid + receipt + Checkr invite + Checkr charge + Daily Close. Every step is
//     idempotent (per-step markers), so payments already finished change nothing;
//  3) applications marked paid (last 10 days) whose payment is NOT captured → System Health.
// One open issue per payment (not repeated every day while it is open).
const STALE_MS = 2 * 60 * 60 * 1000;

async function alertOnce(companyId: string | null, ref: string, message: string) {
  if (!companyId) return;
  const { data } = await supabase
    .from("system_health_issues")
    .select("id")
    .eq("company_id", companyId)
    .eq("issue_type", "lot_payment_stuck")
    .eq("resolved", false)
    .like("message", `%${ref}%`)
    .limit(1);
  if (data && data.length > 0) return;
  await logSystemHealthIssue({ companyId, issueType: "lot_payment_stuck", source: "lot_payment_reconcile", message });
}

async function companyOfApplication(applicationId: string | undefined | null): Promise<{ companyId: string | null; name: string | null }> {
  if (!applicationId) return { companyId: null, name: null };
  const { data } = await supabase.from("resident_applications").select("company_id, full_name").eq("id", applicationId).maybeSingle();
  return { companyId: data?.company_id || null, name: data?.full_name || null };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!stripe) return NextResponse.json({ error: "Stripe is not configured" }, { status: 500 });

  const out = { checked: 0, finished: 0, alerted: 0, paidNotCaptured: 0, errors: [] as string[] };
  const cutoff = Math.floor((Date.now() - STALE_MS) / 1000);

  // 1) Authorizations still waiting.
  for (const kind of ["application_fee", "rent_to_own_deposit"] as const) {
    let page: string | undefined;
    for (let i = 0; i < 5; i++) {
      let res: Stripe.ApiSearchResult<Stripe.PaymentIntent>;
      try {
        res = await stripe.paymentIntents.search({
          query: `metadata['lot_checkout']:'${kind}' AND status:'requires_capture' AND created<${cutoff}`,
          limit: 100,
          ...(page ? { page } : {}),
        });
      } catch (e: any) {
        out.errors.push(`search ${kind}: ${e?.message}`);
        break;
      }
      for (const pi of res.data) {
        out.checked++;
        const applicationId = pi.metadata?.application_id;
        const { companyId: appCompany, name } = await companyOfApplication(applicationId);
        const companyId = pi.metadata?.company_id || appCompany;
        const label = kind === "application_fee" ? "application fee" : "Rent-to-Own deposit";
        try {
          const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
          const session = sessions.data[0];
          let result: "retry" | void = "retry";
          if (session && session.status === "complete") {
            result = kind === "application_fee" ? await handleApplicationFeePaid(session) : await handleRentToOwnDepositPaid(session);
          }
          const after = await stripe.paymentIntents.retrieve(pi.id);
          if (after.status === "succeeded" || after.status === "canceled") { out.finished++; continue; }
          out.alerted++;
          await alertOnce(companyId, pi.id,
            `${name || "An applicant"}'s ${label} card payment ($${(pi.amount / 100).toFixed(2)}) is still only AUTHORIZED (not charged) ${Math.round((Date.now() / 1000 - pi.created) / 3600)} hours after checkout${result === "retry" ? " — the automatic finish failed again" : ""}. The system keeps trying every day; card authorizations expire after about 7 days. Please do NOT capture or cancel it in Stripe by hand — contact MelyOS support so the lot, receipt and background check stay in step. Stripe ${pi.id}${session ? `, session ${session.id}` : ""}.`);
        } catch (e: any) {
          out.errors.push(`${pi.id}: ${e?.message}`);
          out.alerted++;
          await alertOnce(companyId, pi.id,
            `${name || "An applicant"}'s ${label} card payment ($${(pi.amount / 100).toFixed(2)}) is still only AUTHORIZED and the daily check could not finish it (${String(e?.message || "error").slice(0, 200)}). It is retried every day. Please do NOT capture or cancel it in Stripe by hand — contact MelyOS support. Stripe ${pi.id}.`);
        }
      }
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
  }

  // 2) Captured lot payments of the last 7 days: finish anything that never ran (idempotent).
  const weekAgo = Math.floor((Date.now() - 7 * 86400000) / 1000);
  for (const kind of ["application_fee", "rent_to_own_deposit"] as const) {
    let page: string | undefined;
    for (let i = 0; i < 5; i++) {
      let res: Stripe.ApiSearchResult<Stripe.PaymentIntent>;
      try {
        res = await stripe.paymentIntents.search({
          query: `metadata['lot_checkout']:'${kind}' AND status:'succeeded' AND created>${weekAgo}`,
          limit: 100,
          ...(page ? { page } : {}),
        });
      } catch (e: any) {
        out.errors.push(`search succeeded ${kind}: ${e?.message}`);
        break;
      }
      for (const pi of res.data) {
        try {
          const sessions = await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 });
          const session = sessions.data[0];
          if (!session || session.status !== "complete") continue;
          const r = kind === "application_fee" ? await handleApplicationFeePaid(session) : await handleRentToOwnDepositPaid(session);
          if (r === "retry") {
            const { companyId: appCompany, name } = await companyOfApplication(pi.metadata?.application_id);
            out.alerted++;
            await alertOnce(pi.metadata?.company_id || appCompany, pi.id,
              `${name || "An applicant"}'s ${kind === "application_fee" ? "application fee" : "Rent-to-Own deposit"} payment ($${(pi.amount / 100).toFixed(2)}) was collected, but the system could not finish recording it yet (marking it paid, receipt, background check). It is retried every day — contact MelyOS support if this stays open. Stripe ${pi.id}, session ${session.id}.`);
          } else {
            out.finished++;
          }
        } catch (e: any) {
          out.errors.push(`${pi.id}: ${e?.message}`);
        }
      }
      if (!res.has_more || !res.next_page) break;
      page = res.next_page;
    }
  }

  // 3) Marked paid, but the payment isn't captured.
  const since = new Date(Date.now() - 10 * 86400000).toISOString();
  const staleIso = new Date(Date.now() - STALE_MS).toISOString();
  const { data: paidApps, error: appsErr } = await supabase
    .from("resident_applications")
    .select("id, company_id, full_name, application_fee_stripe_payment_intent_id, application_fee_paid_at")
    .eq("application_fee_paid", true)
    .not("application_fee_stripe_payment_intent_id", "is", null)
    .gte("application_fee_paid_at", since)
    .lt("application_fee_paid_at", staleIso)
    .limit(200);
  if (appsErr) out.errors.push(`applications: ${appsErr.message}`);
  for (const app of paidApps || []) {
    const piId = app.application_fee_stripe_payment_intent_id as string;
    const pi = await stripe.paymentIntents.retrieve(piId).catch(() => null);
    if (!pi || pi.status === "succeeded") continue;
    out.paidNotCaptured++;
    await alertOnce(app.company_id, piId,
      `${app.full_name || "An applicant"}'s application is marked as fee PAID, but its card payment is "${pi.status.replace(/_/g, " ")}" in Stripe — the money was not collected. ${pi.status === "requires_capture" ? "The system keeps trying to finish it — do not capture it in Stripe by hand; contact MelyOS support if this stays open." : "Ask them to pay again, or mark the fee unpaid."} Stripe ${piId}, application ${app.id}.`);
  }

  return NextResponse.json(out);
}
