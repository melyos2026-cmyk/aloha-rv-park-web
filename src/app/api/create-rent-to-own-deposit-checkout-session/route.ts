import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/**
 * Creates a Stripe Checkout session for a Rent-to-Own deposit, when the
 * admin chose "let them pay it by card in the application" instead of
 * collecting it in person (cash/check/Zelle).
 */
export async function POST(req: Request) {
  try {
    const { applicationId } = await req.json();

    if (!applicationId) {
      return NextResponse.json({ error: "Missing application ID" }, { status: 400 });
    }

    const { data: application, error } = await supabase
      .from("resident_applications")
      .select("id, full_name, email, rent_to_own_deposit, rent_to_own_deposit_paid, company_id")
      .eq("id", applicationId)
      .single();

    if (error || !application) {
      return NextResponse.json({ error: error?.message ?? "Application not found" }, { status: 400 });
    }

    if (application.rent_to_own_deposit_paid) {
      return NextResponse.json({ error: "This deposit has already been paid." }, { status: 400 });
    }

    const depositAmount = Number(application.rent_to_own_deposit) || 0;
    if (depositAmount <= 0) {
      return NextResponse.json({ error: "No deposit amount set for this application." }, { status: 400 });
    }

    const hostHeader = req.headers.get("host") || "aloharvparkfl.com";
    const protocol = hostHeader.includes("localhost") ? "http" : "https";
    const siteUrl = `${protocol}://${hostHeader}`;

    // Aug 4 (per Mely correction): this IS processed through Stripe, so it
    // gets the same processing fee as every other card charge — 4% or the
    // fixed minimum, whichever is greater, respecting the same
    // pass_processing_fee_to_resident toggle as invoices/rent.
    const { data: feeSettings } = await supabase
      .from("company_fee_settings")
      .select("pass_processing_fee_to_resident")
      .eq("company_id", application.company_id || "")
      .maybeSingle();

    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
    const processingFee = calculateProcessingFee(depositAmount);
    const chargeAmount = passFeeToResident ? depositAmount + processingFee : depositAmount;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(depositAmount * 100),
          product_data: {
            name: "Rent-to-Own Deposit",
            description: `Deposit for ${application.full_name || "applicant"}`,
          },
        },
      },
    ];

    if (passFeeToResident) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(processingFee * 100),
          product_data: { name: "Card Processing Fee" },
        },
      });
    }

    // Aloha's full deposit amount goes to their balance either way; MelyOS
    // keeps only the processing fee (from the resident if they're paying
    // it, or out of the deposit itself if the park absorbs it).
    const alohaShare = passFeeToResident ? depositAmount : depositAmount - processingFee;
    const connectSplit = application.company_id
      ? await resolveConnectSplit(application.company_id, chargeAmount, alohaShare)
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
        type: "rent_to_own_deposit",
        application_id: application.id,
      },
      success_url: `${siteUrl}/apply/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/apply?application_id=${application.id}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not create checkout session." }, { status: 500 });
  }
}
