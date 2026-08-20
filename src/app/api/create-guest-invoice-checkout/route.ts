import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/create-guest-invoice-checkout
// Body: { token }
// Aug 5 (per Mely): lets someone who ISN'T the resident pay a specific
// invoice via a link the admin shared (Create Invoice → "Get Guest
// Payment Link") — no portal login needed. Charges ONLY the one invoice
// this token points to (never all of a resident's pending invoices),
// with the exact same fee/tax/Connect-split math as the regular
// resident checkout, so Aloha/MelyOS's revenue split is unaffected by
// who physically clicked "Pay."
export async function POST(req: Request) {
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: "Missing payment link token." }, { status: 400 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("resident_invoices")
      .select("*")
      .eq("guest_payment_token", token)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Payment link not found or expired." }, { status: 404 });
    }

    if (invoice.status === "Paid") {
      return NextResponse.json({ error: "This invoice has already been paid." }, { status: 400 });
    }

    const totalAmount = Number(invoice.total_amount || 0);
    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No balance due on this invoice." }, { status: 400 });
    }

    // Aug 20 (per Mely — "se puede mejor anadirles los dias por los que
    // se esta pagando... tal y como le muestra en la aplicacion a las
    // personas para que no se vallan a confundir"): a bare "Invoice —
    // August 2026" line doesn't say what it actually covers. Uses the
    // real per-item descriptions already created alongside this invoice
    // (e.g. "Prorated rent — 10 of 31 days", "Security Deposit"),
    // concatenated into one Stripe line description, falling back to the
    // generic month label only if this invoice somehow has no items.
    const { data: invoiceItemsForCheckout } = await supabase
      .from("resident_invoice_items")
      .select("description")
      .eq("invoice_id", invoice.id);
    const invoiceLineDescription =
      invoiceItemsForCheckout && invoiceItemsForCheckout.length > 0
        ? invoiceItemsForCheckout.map((i) => i.description).join(" + ")
        : `Invoice — ${invoice.invoice_month}`;

    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("company_id")
      .eq("id", invoice.resident_id)
      .maybeSingle();

    const { data: feeSettings } = await supabase
      .from("company_fee_settings")
      .select("pass_processing_fee_to_resident")
      .eq("company_id", resident?.company_id || "")
      .maybeSingle();

    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
    const processingFee = calculateProcessingFee(totalAmount);

    const { data: taxSettings } = await supabase
      .from("company_tax_settings")
      .select("enable_tax, manual_tax_rate_percent, rent_tax_mode")
      .eq("company_id", resident?.company_id || "")
      .maybeSingle();
    const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
    const taxEnabled = !!taxSettings?.enable_tax && taxRatePercent > 0 && taxSettings?.rent_tax_mode === "excluded";
    const taxAmount = taxEnabled ? totalAmount * (taxRatePercent / 100) : 0;

    const chargeAmount = totalAmount + taxAmount + (passFeeToResident ? processingFee : 0);

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://aloharvparkfl.com";

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(totalAmount * 100),
          product_data: {
            name: "Aloha RV Park Balance",
            description: invoiceLineDescription,
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
        resident_id: invoice.resident_id,
        invoice_ids: invoice.id,
        processing_fee_charged: passFeeToResident ? String(processingFee) : "0",
        tax_charged: String(taxAmount),
        tax_rate_percent: String(taxRatePercent),
      },
      success_url: `${siteUrl}/pay-invoice/${token}?paid=success`,
      cancel_url: `${siteUrl}/pay-invoice/${token}?paid=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not create payment session." },
      { status: 500 }
    );
  }
}
