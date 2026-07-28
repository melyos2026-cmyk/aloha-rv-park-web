import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/portal/confirm-autopay
// Body: { residentId, paymentMethodId }
// Called after the resident's card was successfully saved via Stripe
// Elements (SetupIntent). Sets this as their default payment method for
// autopay and enables it.
export async function POST(req: NextRequest) {
  const { residentId, paymentMethodId } = await req.json();

  if (!residentId || !paymentMethodId) {
    return NextResponse.json({ error: "residentId and paymentMethodId are required." }, { status: 400 });
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  const last4 = paymentMethod.card?.last4 || null;

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      stripe_payment_method_id: paymentMethodId,
      autopay_enabled: true,
      autopay_card_last4: last4,
    })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, last4 });
}
