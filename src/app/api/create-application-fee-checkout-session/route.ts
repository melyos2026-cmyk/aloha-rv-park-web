import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

/**
 * Creates a Stripe Checkout session for the Application Fee + Background Check.
 * This charge goes to MelyOS's own Stripe account (not the park's) - it's
 * Mely's revenue for providing the screening service, split with the park
 * afterward (park_share_total, tracked in resident_applications).
 */
export async function POST(req: Request) {
  try {
    const { applicationId } = await req.json();

    if (!applicationId) {
      return NextResponse.json(
        { error: "Missing application ID" },
        { status: 400 }
      );
    }

    const { data: application, error } = await supabase
      .from("resident_applications")
      .select(
        "id, full_name, email, application_fee_total, application_fee_paid"
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

    const amount = Number(application.application_fee_total) || 0;
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Application fee total is $0 - nothing to charge." },
        { status: 400 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: application.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: "Rental Application Fee & Background Check",
              description: `Application fee for ${application.full_name || "applicant"}`,
            },
          },
        },
      ],
      metadata: {
        type: "application_fee",
        application_id: application.id,
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
