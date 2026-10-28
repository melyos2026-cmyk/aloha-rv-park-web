import { demoPaymentBlock } from "@/lib/demoPayments";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";
import {
  applicationHoldRef, attachSessionToHold, expireOlderSession, lotSessionExpiresAt, otherPaidHolder,
  releaseLotCheckoutHold, takeLotCheckoutHold, LOT_TAKEN_MESSAGE,
} from "@/lib/lotCheckoutHold";

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
      .select("id, full_name, email, rent_to_own_deposit, rent_to_own_deposit_paid, company_id, space_id, status")
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

    // Oct 21 (per Mely): no real payments on demo companies.
    { const demoBlocked = await demoPaymentBlock(application.company_id); if (demoBlocked) return demoBlocked; }

    // Oct 28 (per Mely — two people paying for the same lot at once): another live application
    // already paid for this lot → stop; otherwise hold the lot for this application while it checks
    // out (same hold as its application-fee checkout — one ref per application).
    const holdRef = applicationHoldRef(application.id);
    let hold: Awaited<ReturnType<typeof takeLotCheckoutHold>> | null = null;
    // Oct 28 (review): an APPROVED applicant's lot is already theirs (e.g. the buyer of a resident's
    // for-sale lot) — no paid-holder check and no hold, so a Pending applicant can't block them.
    if (application.space_id && application.company_id && application.status !== "Approved") {
      const other = await otherPaidHolder(application.company_id, application.space_id, application.id);
      if (other.error) return NextResponse.json({ error: "Could not check this lot right now. Please try again." }, { status: 503 });
      if (other.holder) return NextResponse.json({ error: LOT_TAKEN_MESSAGE }, { status: 409 });
      hold = await takeLotCheckoutHold(application.space_id, application.company_id, holdRef);
      if (!hold.ok) return NextResponse.json({ error: hold.message }, { status: hold.reason === "held" ? 409 : 503 });
    }

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: application.email || undefined,
        line_items: lineItems,
        expires_at: lotSessionExpiresAt(), // Oct 28: ends before the lot hold does
        // Oct 28 (per Mely): authorize only; stripe-webhook captures after re-checking the lot, or
        // cancels the authorization if it went to someone else. The Connect split happens at capture.
        payment_intent_data: {
          capture_method: "manual",
          metadata: { lot_checkout: "rent_to_own_deposit", application_id: application.id, ...(application.company_id ? { company_id: application.company_id } : {}) },
          ...(connectSplit
            ? {
                application_fee_amount: connectSplit.applicationFeeAmountCents,
                transfer_data: { destination: connectSplit.connectedAccountId },
                ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
              }
            : {}),
        },
        metadata: {
          type: "rent_to_own_deposit",
          application_id: application.id,
          lot_id: application.space_id || "",
          lot_hold_ref: application.space_id ? holdRef : "",
          capture: "manual",
        },
        success_url: `${siteUrl}/apply/confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/apply?application_id=${application.id}`,
      });
    } catch (createErr) {
      if (hold?.ok && hold.supported && hold.newlyTaken && application.space_id) await releaseLotCheckoutHold(application.space_id, holdRef);
      throw createErr;
    }

    if (hold?.ok && hold.supported && application.space_id) {
      await attachSessionToHold(application.space_id, holdRef, session.id);
      await expireOlderSession(hold.previousSessionId, session.id, "rent_to_own_deposit");
    }

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not create checkout session." }, { status: 500 });
  }
}
