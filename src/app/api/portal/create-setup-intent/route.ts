import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/portal/create-setup-intent
// Body: { residentId }
// Creates (or reuses) a Stripe Customer for this resident, then a
// SetupIntent so their card can be saved via Stripe Elements without
// charging anything yet — the actual card number never touches our
// servers, only Stripe's.
export async function POST(req: NextRequest) {
  const { residentId } = await req.json();

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  // SECURITY: require the caller's own signed session to match this
  // residentId — otherwise anyone could start a card-save flow tied to a
  // DIFFERENT resident's account just by knowing/guessing their id.
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error } = await supabase
    .from("resident_accounts")
    .select("id, full_name, email, stripe_customer_id")
    .eq("id", residentId)
    .single();

  if (error || !resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  let customerId = resident.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      name: resident.full_name || undefined,
      email: resident.email || undefined,
      metadata: { resident_id: resident.id },
    });
    customerId = customer.id;

    await supabase
      .from("resident_accounts")
      .update({ stripe_customer_id: customerId })
      .eq("id", residentId);
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
  });

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
