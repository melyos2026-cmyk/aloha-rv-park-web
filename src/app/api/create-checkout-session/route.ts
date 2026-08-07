import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
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

    // Aug 5 (per Mely): same company-wide sales tax settings used for
    // propane/reservations (rate + included/excluded/blank mode, varies
    // by county). "excluded" adds tax as its own line item; "included"
    // means the rent amount already has tax baked in; blank/null means
    // no mode chosen yet, so no tax on rent — matches Mely's real-world
    // expectation that long-term resident rent is typically NOT taxable
    // in Florida, unlike short-term reservations.
    const { data: taxSettings } = await supabase
      .from("company_tax_settings")
      .select("enable_tax, manual_tax_rate_percent, rent_tax_mode")
      .eq("company_id", resident?.company_id || "")
      .maybeSingle();
    const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
    const taxEnabled = !!taxSettings?.enable_tax && taxRatePercent > 0 && taxSettings?.rent_tax_mode === "excluded";
    const taxAmount = taxEnabled ? totalAmount * (taxRatePercent / 100) : 0;

    const chargeAmount = totalAmount + taxAmount + (passFeeToResident ? processingFee : 0);

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

    if (taxAmount > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(taxAmount * 100),
          product_data: { name: `Sales Tax (${taxRatePercent}%)` },
        },
      });
    }

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

    // Aloha's share is the full invoice amount PLUS all of the tax
    // (theirs to remit) — MelyOS's cut is only the processing fee, taken
    // from the resident's payment if they're covering it, or otherwise
    // out of the park's own invoice amount.
    const alohaShare = totalAmount + taxAmount + (passFeeToResident ? 0 : -processingFee);
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
        // Aug 5 (per Mely): so the webhook can persist these as real
        // resident_invoice_items once payment is confirmed — otherwise
        // the fee/tax only ever existed as ephemeral Stripe line items,
        // never reflected on the invoice record itself.
        processing_fee_charged: passFeeToResident ? String(processingFee) : "0",
        tax_charged: String(taxAmount),
        tax_rate_percent: String(taxRatePercent),
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

