import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/**
 * Creates a Stripe Checkout session for the Application Fee (+ Background
 * Check, when one applies). The application fee itself is Mely's revenue
 * for providing the screening service, split with the park afterward
 * (park_share_total, tracked in resident_applications). For short stays
 * (no background check required), the stay total is combined into this
 * same checkout as a second line item — that revenue belongs to the park,
 * tracked the same way rent normally is; only the accounting distinction
 * is internal (park_share_total), not a separate Stripe charge.
 */
export async function POST(req: Request) {
  try {
    const {
      applicationId,
      stayAmount,
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
        "id, full_name, email, application_fee_total, application_fee_paid, sms_fee_amount"
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

    const smsFee = Number(application.sms_fee_amount) || 0;
    const feeAmount = (Number(application.application_fee_total) || 0) + smsFee;
    const stayAmountNum = Number(stayAmount) || 0;
    if (feeAmount <= 0 && stayAmountNum <= 0) {
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: application.email || undefined,
      line_items: lineItems,
      metadata: {
        type: "application_fee",
        application_id: application.id,
        requires_background_check:
          requiresBackgroundCheck === false ? "false" : "true",
        stay_amount: String(stayAmountNum || 0),
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
