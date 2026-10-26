import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/portal/confirm-autopay
// Body: { residentId, paymentMethodId }
// Called after the resident's card was successfully saved via Stripe
// Elements (SetupIntent). Sets this as their default payment method for
// autopay and enables it.
export async function POST(req: NextRequest) {
  const { residentId, paymentMethodId, authorizationAccepted, authorizationText } = await req.json();

  if (!residentId || !paymentMethodId) {
    return NextResponse.json({ error: "residentId and paymentMethodId are required." }, { status: 400 });
  }

  // SECURITY: require the caller's own signed session to match this
  // residentId — otherwise anyone could enable autopay with THEIR OWN card
  // on a DIFFERENT resident's account just by knowing/guessing their id.
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  // Oct 19 (per Mely): a written recurring-charge authorization is required
  if (authorizationAccepted !== true || !String(authorizationText || "").trim()) {
    return NextResponse.json({ error: "Please accept the recurring charge authorization." }, { status: 400 });
  }
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  const last4 = paymentMethod.card?.last4 || null;

  const { error } = await supabase
    .from("resident_accounts")
    .update({
      stripe_payment_method_id: paymentMethodId,
      autopay_enabled: true,
      autopay_card_last4: last4,
      autopay_authorized_at: new Date().toISOString(),
      autopay_authorization_text: String(authorizationText).slice(0, 2000),
      autopay_authorization_ip: ip,
    })
    .eq("id", residentId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("full_name, company_id")
    .eq("id", residentId)
    .maybeSingle();
  if (resident) {
    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: residentId,
      resident_name: resident.full_name,
      update_type: "autopay_enabled",
      message: `${resident.full_name} turned on autopay (card ending in ${last4 || "—"}) and accepted the recurring charge authorization.`,
    });
  }

  return NextResponse.json({ success: true, last4 });
}
