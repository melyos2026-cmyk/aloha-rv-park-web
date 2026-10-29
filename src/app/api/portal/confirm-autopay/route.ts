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

  if (typeof paymentMethodId !== "string" || !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)) {
    return NextResponse.json({ error: "Card not found. Please try again." }, { status: 400 });
  }
  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
  if (!paymentMethod) return NextResponse.json({ error: "Card not found. Please try again." }, { status: 400 });
  // Oct 28 (review): this route saves CARD autopay only (bank autopay: /api/portal/bank-autopay).
  if (paymentMethod.type !== "card") {
    return NextResponse.json({ error: "This is not a card. Please use a card here, or set up autopay by bank." }, { status: 400 });
  }
  // Oct 29 (live-money audit — Low): the card must be the one saved on THIS resident's own Stripe
  // customer (create-setup-intent attaches it there). Otherwise someone could point autopay at a
  // card id from another customer.
  {
    const { data: owner } = await supabase.from("resident_accounts").select("stripe_customer_id").eq("id", residentId).maybeSingle();
    const pmCustomer = typeof paymentMethod.customer === "string" ? paymentMethod.customer : paymentMethod.customer?.id || null;
    if (!owner?.stripe_customer_id || !pmCustomer || pmCustomer !== owner.stripe_customer_id) {
      return NextResponse.json({ error: "This card isn't saved on your account. Please add it again." }, { status: 400 });
    }
  }
  const last4 = paymentMethod.card?.last4 || null;

  const cardFields = {
    stripe_payment_method_id: paymentMethodId,
    autopay_enabled: true,
    autopay_card_last4: last4,
    autopay_authorized_at: new Date().toISOString(),
    autopay_authorization_text: String(authorizationText).slice(0, 2000),
    autopay_authorization_ip: ip,
  };
  // Oct 28 (per Mely): residents can also autopay by bank — record that this one is a card. Works
  // before rv_ach_autopay.sql adds autopay_method.
  let { error } = await supabase
    .from("resident_accounts")
    .update({ ...cardFields, autopay_method: "card" })
    .eq("id", residentId);
  if (error && (error.code === "42703" || error.code === "PGRST204" || String(error.message || "").includes("autopay_method"))) {
    ({ error } = await supabase.from("resident_accounts").update(cardFields).eq("id", residentId));
  }

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
