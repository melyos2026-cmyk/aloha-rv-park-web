import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveConnectSplit } from "@/lib/platformFee";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/**
 * Creates a Stripe Checkout session for the Application Fee (+ Background
 * Check, when one applies).
 *
 * Aug 10 (per Mely): the background check fee is now 100% the park's own
 * revenue (park_share_total = the full backgroundCheckFeeTotal, computed
 * in /apply/page.tsx) — MelyOS no longer takes a cut of this specific
 * charge. MelyOS's revenue for providing the Checkr integration comes
 * from a SEPARATE charge billed directly to the park's admin (see the
 * Checkr Billing report in melyos-builder — $44.99/$69.99/$99.99 per
 * background check sent, depending on package), unrelated to what the
 * applicant pays here. Only application_processing_fee ($2.50) remains
 * MelyOS's cut of this Stripe checkout.
 *
 * For short stays (no background check required), the stay total is
 * combined into this same checkout as a second line item — that revenue
 * is also 100% the park's, tracked the same way rent normally is; only
 * the accounting distinction is internal (park_share_total), not a
 * separate Stripe charge.
 */
export async function POST(req: Request) {
  try {
    const {
      applicationId,
      stayAmount,
      depositAmount,
      stayStartDate,
      stayEndDate,
      requiresBackgroundCheck,
    } = await req.json();

    if (!applicationId) {
      return NextResponse.json(
        { error: "Missing application ID" },
        { status: 400 }
      );
    }

    const { data: application, error } = await supabase
      .from("resident_applications")
      .select(
        "id, full_name, email, application_fee_total, application_fee_paid, sms_fee_amount, company_id, park_share_total, space_id"
      )
      .eq("id", applicationId)
      .single();

    if (error || !application) {
      return NextResponse.json(
        { error: error?.message ?? "Application not found" },
        { status: 400 }
      );
    }

    if (application.application_fee_paid) {
      return NextResponse.json(
        { error: "This application fee has already been paid." },
        { status: 400 }
      );
    }

    // Aug 6 (per Mely's "semáforo" idea — check the light BEFORE letting
    // someone pay, not charge-then-refund after): if another applicant's
    // payment already put this exact lot on hold, stop here and never
    // even create a Stripe session — their card is never charged at all,
    // so there's nothing to refund.
    if (application.space_id) {
      const { data: lot } = await supabase
        .from("rv_lots")
        .select("status")
        .eq("id", application.space_id)
        .maybeSingle();

      if (lot && lot.status !== "available" && lot.status !== "for_sale") {
        return NextResponse.json(
          { error: "This lot is on hold — please choose a different lot and try again." },
          { status: 409 }
        );
      }
    }

    const smsFee = Number(application.sms_fee_amount) || 0;
    const feeAmount = (Number(application.application_fee_total) || 0) + smsFee;
    const stayAmountNum = Number(stayAmount) || 0;
    const depositAmountNum = Number(depositAmount) || 0;
    if (feeAmount <= 0 && stayAmountNum <= 0 && depositAmountNum <= 0) {
      return NextResponse.json(
        { error: "Nothing to charge." },
        { status: 400 }
      );
    }

   const hostHeader = req.headers.get("host") || "aloharvparkfl.com";
    const protocol = hostHeader.includes("localhost") ? "http" : "https";
    const siteUrl = `${protocol}://${hostHeader}`;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    const requiresBgCheck = requiresBackgroundCheck !== false;

    if (feeAmount > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(feeAmount * 100),
          product_data: {
            name: requiresBgCheck
              ? "Rental Application Fee & Background Check"
              : "Rental Application Fee",
            description: smsFee > 0
              ? `Application fee for ${application.full_name || "applicant"} (includes $${smsFee.toFixed(2)} SMS delivery fee)`
              : `Application fee for ${application.full_name || "applicant"}`,
          },
        },
      });
    }

    // Short stays don't get a separate background-check section in the
    // application — the stay total is charged right alongside the fee here.
    if (stayAmountNum > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(stayAmountNum * 100),
          product_data: {
            name: "RV Lot Stay",
            description:
              stayStartDate && stayEndDate
                ? `Stay from ${stayStartDate} to ${stayEndDate}`
                : `Stay charge for ${application.full_name || "applicant"}`,
          },
        },
      });
    }

    // Aug 17 (per Mely): billed as its own line item, not silently folded
    // into "RV Lot Stay" — a security deposit is a different kind of
    // charge (refundable, held on the resident's behalf) and the
    // applicant should see it broken out.
    if (depositAmountNum > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(depositAmountNum * 100),
          product_data: {
            name: "Security Deposit",
            description: "Refundable deposit, per your lease terms.",
          },
        },
      });
    }

    // Aug 4 (per Mely, Phase 2): Aloha's share is their already-computed
    // park_share_total from this application, PLUS the full stay amount
    // (that's rent revenue, 100% the park's). MelyOS keeps the rest of
    // the application fee. No split if not connected yet.
    const totalChargeAmount = feeAmount + stayAmountNum + depositAmountNum;
    const alohaShare = (Number(application.park_share_total) || 0) + stayAmountNum + depositAmountNum;
    const connectSplit = application.company_id
      ? await resolveConnectSplit(application.company_id, totalChargeAmount, alohaShare)
      : null;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: application.email || undefined,
      line_items: lineItems,
      ...(connectSplit
        ? {
            payment_intent_data: {
              application_fee_amount: connectSplit.applicationFeeAmountCents,
              transfer_data: { destination: connectSplit.connectedAccountId },
            },
          }
        : {}),
      metadata: {
        type: "application_fee",
        application_id: application.id,
        requires_background_check:
          requiresBackgroundCheck === false ? "false" : "true",
        stay_amount: String(stayAmountNum || 0),
        deposit_amount: String(depositAmountNum || 0),
      },
      success_url: `${siteUrl}/apply/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/apply?application_id=${application.id}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not create checkout session." },
      { status: 500 }
    );
  }
}
