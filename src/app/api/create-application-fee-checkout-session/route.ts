import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { resolveConnectSplit, calculateProcessingFee } from "@/lib/platformFee";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// Aug 20 (per Mely — "ok si la persona hace el background check sea
// aporvado o no el dinero... no se devuelve pq el background check fue
// utilizado"): local copy of melyos-builder's services/checkr.ts
// MELYOS_CHECKR_PRICING — deliberately NOT imported directly, same
// reasoning as calculateProcessingFee below (that module's other
// exports pull in server-only dependencies that would crash this
// client-facing checkout page's bundle). Kept in sync by hand.
const MELYOS_CHECKR_PRICING: Record<string, number> = {
  basic_plus_criminal: 44.99,
  essential_criminal: 69.99,
  complete_criminal: 99.99,
  rv_park_tenant_screening: 44.99,
};

/**
 * Creates a Stripe Checkout session for the Application Fee (+ Background
 * Check, when one applies).
 *
 * Aug 20 (per Mely — real-money design decision, confirmed after testing
 * a live payment): MelyOS's cut of the background check now comes
 * straight out of THIS SAME checkout via the existing Connect split,
 * calculated the moment the applicant pays — not a separate monthly
 * invoice. This works because Checkr's invitation is sent automatically
 * in the SAME stripe-webhook handler that confirms this payment
 * (createCheckrInvitation runs right after application_fee_paid gets set
 * — see handleApplicationFeePayment), so the real package/cost is
 * already a known fact by the time this checkout completes, not a guess
 * about a future approval. And per Mely: this fee is never refunded
 * regardless of whether the application is later approved or rejected —
 * the background check was already run and already cost MelyOS money
 * either way, so charging it here (rather than waiting to see if the
 * admin approves) carries no real risk.
 *
 * Earlier design (Aug 10): background check fee was 100% the park's own
 * revenue, with MelyOS's cut billed separately via the Checkr Billing
 * report in melyos-builder. Only application_processing_fee ($2.50)
 * used to be MelyOS's cut of this specific checkout — now MelyOS's
 * Checkr cost is ALSO deducted from Aloha's share here, automatically.
 *
 * For short stays (no background check required), the stay total is
 * combined into this same checkout as a second line item — that revenue
 * is also 100% the park's, tracked the same way rent normally is; only
 * the accounting distinction is internal (park_share_total), not a
 * separate Stripe charge.
 */
export async function POST(req: Request) {
  try {
    const {
      applicationId,
      stayAmount,
      depositAmount,
      stayStartDate,
      stayEndDate,
      requiresBackgroundCheck,
      isWalkIn,
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
        "id, full_name, email, application_fee_total, application_fee_paid, sms_fee_amount, company_id, park_share_total, space_id, application_fee_primary, application_fee_per_additional, application_fee_additional_count"
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

    // Aug 6 (per Mely's "semáforo" idea — check the light BEFORE letting
    // someone pay, not charge-then-refund after): if another applicant's
    // payment already put this exact lot on hold, stop here and never
    // even create a Stripe session — their card is never charged at all,
    // so there's nothing to refund.
    // Aug 17 (per Mely — "no me llegó el mensaje de que tengo que pagar
    // por stripe"): this held-lot check only ever allowed 'available' or
    // 'for_sale' — a lot being sold by its CURRENT resident (like C11,
    // still legitimately 'occupied' by the seller until the sale closes
    // on approval) was silently rejected here, before the buyer's
    // checkout session was ever created. Now also allows through when a
    // real active resident-owned sale/RTO listing exists for this exact
    // lot — the same underlying fact every other part of this flow
    // today (the locked Move-In date, the conflict-check bypass) already
    // relies on to know this occupied-but-being-sold case is legitimate.
    if (application.space_id) {
      const { data: lot } = await supabase
        .from("rv_lots")
        .select("status, lot_name, company_id")
        .eq("id", application.space_id)
        .maybeSingle();

      let hasActiveSaleListing = false;
      if (lot?.lot_name && lot.company_id) {
        const { data: companyRow } = await supabase
          .from("companies")
          .select("park_id")
          .eq("id", lot.company_id)
          .maybeSingle();
        if (companyRow?.park_id) {
          const { data: listing } = await supabase
            .from("real_estate_listings")
            .select("id")
            .eq("park_id", companyRow.park_id)
            .eq("lot_key", lot.lot_name)
            .eq("sold", false)
            .eq("seller_type", "resident")
            .in("type", ["sale", "rent-to-own"])
            .maybeSingle();
          hasActiveSaleListing = !!listing;
        }
      }

      if (
        lot &&
        lot.status !== "available" &&
        lot.status !== "for_sale" &&
        !hasActiveSaleListing
      ) {
        return NextResponse.json(
          { error: "This lot is on hold — please choose a different lot and try again." },
          { status: 409 }
        );
      }
    }

    const smsFee = Number(application.sms_fee_amount) || 0;
    const feeAmount = (Number(application.application_fee_total) || 0) + smsFee;
    const stayAmountNum = Number(stayAmount) || 0;
    const depositAmountNum = Number(depositAmount) || 0;
    if (feeAmount <= 0 && stayAmountNum <= 0 && depositAmountNum <= 0) {
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

    const applicationFeePrimary = requiresBgCheck ? (Number(application.application_fee_primary) || 0) : 0;
    const additionalCount = Number(application.application_fee_additional_count) || 0;
    const applicationFeeAdditional = requiresBgCheck
      ? (Number(application.application_fee_per_additional) || 0) * additionalCount
      : 0;
    // The flat $2.50 processing fee is whatever's left of application_fee_total
    // once the background check portion (if any) is accounted for.
    const applicationProcessingFeeOnly = feeAmount - applicationFeePrimary - applicationFeeAdditional;

    // Aug 20 (per Mely): MelyOS's real Checkr cost for THIS application,
    // deducted from Aloha's share below. Uses the same package the
    // stripe-webhook will actually send moments from now (both read the
    // same park_settings.checkr_default_package_slug), so this is the
    // real cost, not an estimate.
    let checkrCostTotal = 0;
    if (requiresBgCheck && application.company_id) {
      const { data: parkSettings } = await supabase
        .from("park_settings")
        .select("checkr_default_package_slug")
        .eq("company_id", application.company_id)
        .maybeSingle();
      const packageSlug = parkSettings?.checkr_default_package_slug || "basic_plus_criminal";
      const costPerCheck = MELYOS_CHECKR_PRICING[packageSlug] ?? MELYOS_CHECKR_PRICING.basic_plus_criminal;
      const numChecks = 1 + additionalCount;
      checkrCostTotal = Math.round(costPerCheck * numChecks * 100) / 100;
    }

    // Aug 20 (per Mely — "el aplication fee debe apareces luego de OK,
    // Submit en la pantalla de stripe junto al procesing fee... asi que
    // en before you submit> charged today> Background Check (Primary
    // Applicant)>Additional Background Checks, 'Ok, Submit'. Stripe
    // Background Check (Primary Applicant)>Additional Background Checks
    // >Application Fee> Procesing fee"): Stripe's own line items (and
    // the email receipt it generates) now break these out exactly the
    // same way the "Before You Submit" modal already does on the apply
    // page, instead of folding them into one combined line — same order:
    // Background Check (Primary Applicant) -> Additional Background
    // Checks -> Application Fee -> Card Processing Fee.
    if (applicationFeePrimary > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(applicationFeePrimary * 100),
          product_data: {
            name: "Background Check (Primary Applicant)",
            description: `For ${application.full_name || "the primary applicant"}`,
          },
        },
      });
    }

    if (applicationFeeAdditional > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(applicationFeeAdditional * 100),
          product_data: {
            name: "Additional Background Checks",
            description: `${additionalCount} additional occupant${additionalCount === 1 ? "" : "s"} requiring a background check`,
          },
        },
      });
    }

    if (applicationProcessingFeeOnly > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(applicationProcessingFeeOnly * 100),
          product_data: {
            name: "Application Fee",
            description: smsFee > 0
              ? `Includes $${smsFee.toFixed(2)} SMS delivery fee`
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

    // Aug 17 (per Mely): billed as its own line item, not silently folded
    // into "RV Lot Stay" — a security deposit is a different kind of
    // charge (refundable, held on the resident's behalf) and the
    // applicant should see it broken out.
    if (depositAmountNum > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(depositAmountNum * 100),
          product_data: {
            name: "Security Deposit",
            description: "Refundable deposit, per your lease terms.",
          },
        },
      });
    }

    // Aug 17 (per Mely — "y donde se cobra el 4% de la tarjeta que no lo
    // veo pq cada transacion de stripe cobra eso?"): this route never
    // wired up the same processing-fee surcharge already used everywhere
    // else money gets charged (propane, rent, RTO deposit, autopay — see
    // src/lib/platformFee.ts) — Stripe's own cut (2.9% + $0.30, more with
    // Connect) was being silently absorbed out of Aloha's/MelyOS's share
    // instead of passed to whoever's configured to pay it. Same formula,
    // same company_fee_settings.pass_processing_fee_to_resident toggle,
    // shown as its own line item so it's never hidden from the applicant.
    const { data: feeSettings } = await supabase
      .from("company_fee_settings")
      .select("pass_processing_fee_to_resident")
      .eq("company_id", application.company_id || "")
      .maybeSingle();
    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
    const preSurchargeTotal = feeAmount + stayAmountNum + depositAmountNum;
    const cardProcessingFee = passFeeToResident ? calculateProcessingFee(preSurchargeTotal) : 0;

    if (cardProcessingFee > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(cardProcessingFee * 100),
          product_data: {
            name: "Card Processing Fee",
            description: "Covers the cost of paying by card online.",
          },
        },
      });
    }

    // Aug 4 (per Mely, Phase 2): Aloha's share is their already-computed
    // park_share_total from this application, PLUS the full stay amount
    // (that's rent revenue, 100% the park's). MelyOS keeps the rest of
    // the application fee. No split if not connected yet.
    // Aug 17: totalChargeAmount now includes the card processing fee
    // surcharge above — alohaShare deliberately does NOT, since MelyOS
    // keeps 100% of that surcharge (it exists specifically to cover
    // MelyOS's own Stripe/Connect costs), same as every other checkout
    // that already uses this same processing-fee pattern.
    const totalChargeAmount = feeAmount + stayAmountNum + depositAmountNum + cardProcessingFee;
    const alohaShare = Math.max(
      0,
      (Number(application.park_share_total) || 0) + stayAmountNum + depositAmountNum - checkrCostTotal
    );
    const connectSplit = application.company_id
      ? await resolveConnectSplit(application.company_id, totalChargeAmount, alohaShare)
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
        type: "application_fee",
        application_id: application.id,
        requires_background_check:
          requiresBackgroundCheck === false ? "false" : "true",
        stay_amount: String(stayAmountNum || 0),
        deposit_amount: String(depositAmountNum || 0),
        card_processing_fee: String(cardProcessingFee || 0),
        checkr_fee_charged_via_connect: String(checkrCostTotal > 0),
        checkr_fee_deducted_amount: String(checkrCostTotal || 0),
      },
      success_url: `${siteUrl}/apply/confirmation?session_id={CHECKOUT_SESSION_ID}`,
      // Aug 24 (per Mely — found live: after cancelling/backing out of
      // Stripe, the walk-in note disappeared from the confirm modal on
      // return because this URL never preserved the walkin=true param
      // the original /apply?walkin=true link had): carries isWalkIn
      // through so a walk-in returning here (to fix something and
      // resubmit) still sees the in-person-payment option.
      cancel_url: `${siteUrl}/apply?application_id=${application.id}${isWalkIn ? "&walkin=true" : ""}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not create checkout session." },
      { status: 500 }
    );
  }
}
