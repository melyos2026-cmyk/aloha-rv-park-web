import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// resident_payments (the legacy billing table) has been fully unified into
// resident_invoices — this route now only ever charges pending invoices.
export async function POST(req: Request) {
  try {
    const { residentId } = await req.json();

    if (!residentId) {
      return NextResponse.json({ error: "Missing resident ID" }, { status: 400 });
    }

    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("company_id")
      .eq("id", residentId)
      .maybeSingle();

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

    // Aug 4 (per Mely, Phase 2): processing fee — 4% or the fixed minimum,
    // whichever is greater — same formula everywhere (see
    // src/lib/platformFee.ts). Whether the RESIDENT pays it on top or the
    // PARK absorbs it from their own share is controlled by the existing
    // company_fee_settings.pass_processing_fee_to_resident toggle; either
    // way, Aloha's real invoice/rent amount goes to them in full and
    // MelyOS keeps only the processing fee itself.
    const { data: feeSettings } = await supabase
      .from("company_fee_settings")
      .select("pass_processing_fee_to_resident")
      .eq("company_id", resident?.company_id || "")
      .maybeSingle();

    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
    const processingFee = calculateProcessingFee(totalAmount);
    const chargeAmount = passFeeToResident ? totalAmount + processingFee : totalAmount;

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
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

    // Aloha's share is always the full invoice amount — if the resident
    // is paying the fee on top, MelyOS's cut comes only from that fee; if
    // the park absorbs it instead, MelyOS's cut comes out of the park's
    // own invoice amount.
    const alohaShare = passFeeToResident ? totalAmount : totalAmount - processingFee;
    const connectSplit = resident?.company_id
      ? await resolveConnectSplit(resident.company_id, chargeAmount, alohaShare)
      : null;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
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

