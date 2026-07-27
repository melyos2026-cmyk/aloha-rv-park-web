import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

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
      .select("id, full_name, email, rent_to_own_deposit, rent_to_own_deposit_paid")
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: application.email || undefined,
      line_items: [
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
      ],
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
