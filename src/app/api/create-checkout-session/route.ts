import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// resident_payments (the legacy billing table) has been fully unified into
// resident_invoices — this route now only ever charges pending invoices.
export async function POST(req: Request) {
  try {
    const { residentId } = await req.json();

    if (!residentId) {
      return NextResponse.json({ error: "Missing resident ID" }, { status: 400 });
    }

    const { data: invoices, error: invoicesError } = await supabase
      .from("resident_invoices")
      .select("*")
      .eq("resident_id", residentId)
      .eq("status", "Pending");

    if (invoicesError) {
      return NextResponse.json({ error: invoicesError.message }, { status: 400 });
    }

    const totalAmount = (invoices || []).reduce(
      (sum, invoice) => sum + Number(invoice.total_amount || 0),
      0
    );

    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No pending balance found." }, { status: 400 });
    }

    const invoiceIds = (invoices || []).map((invoice) => invoice.id);

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
        invoice_ids: invoiceIds.join(","),
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
