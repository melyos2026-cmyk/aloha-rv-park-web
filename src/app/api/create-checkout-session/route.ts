import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { residentId } = await req.json();

    if (!residentId) {
      return NextResponse.json({ error: "Missing resident ID" }, { status: 400 });
    }

    const { data: payments, error } = await supabase
      .from("resident_payments")
      .select("*")
      .eq("resident_id", residentId)
      .in("status", ["Pending", "Late", "Partial"]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const totalAmount = (payments || []).reduce((sum, payment) => {
      return sum + Number(payment.total_due || payment.amount || 0);
    }, 0);

    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No pending balance found." }, { status: 400 });
    }

    const paymentIds = (payments || []).map((payment) => payment.id);

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(totalAmount * 100),
            product_data: {
              name: "Aloha RV Park Balance",
              description: "Outstanding resident balance",
            },
          },
        },
      ],
      metadata: {
        resident_id: residentId,
        payment_ids: paymentIds.join(","),
      },
      success_url: `${siteUrl}/residents/payment-review?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/residents/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not create checkout session." },
      { status: 500 }
    );
  }
}
