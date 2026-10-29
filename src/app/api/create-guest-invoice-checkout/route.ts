import { demoPaymentBlock } from "@/lib/demoPayments";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit, returnedAchFeeTotalsOnInvoices, ReturnedFeeLookupError } from "@/lib/platformFee";
import { isInvoicePayableNow, invoicePayableFrom } from "@/lib/invoicePayable";
import { invoicesPreparing, invoiceGenerateDayForResident } from "@/lib/invoiceRentReady";
import { parkShareMetadata, unsplitRefusal } from "@/lib/parkPayoutLedger";
import { closeOtherInvoiceCheckouts } from "@/lib/invoiceCheckoutSessions";

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
    // Oct 28: a bank (ACH) payment for this invoice is still clearing — it must not be paid twice.
    // Oct 29 (Send to Collections): an invoice placed with the collections agency is paid to the agency,
    // never through this link.
    if ((invoice as any).collection_placement_id) {
      return NextResponse.json({ error: "This balance was referred to a collections agency. Please contact the park office." }, { status: 400 });
    }
    if (invoice.status === "Processing") {
      return NextResponse.json({ error: "A bank payment for this invoice is already processing (3–5 business days). Nothing to pay right now." }, { status: 400 });
    }

    // Oct 28 (review) / Oct 29: an invoice two or more months ahead can't be paid yet (next month's can,
    // from the invoice generation day — checked just below).
    if (!isInvoicePayableNow(invoice.invoice_month)) {
      const genDay = await invoiceGenerateDayForResident(invoice.resident_id);
      return NextResponse.json({ error: `This invoice can be paid starting ${invoicePayableFrom(invoice.invoice_month, undefined, genDay)}.` }, { status: 400 });
    }

    // Oct 28 (review) / Oct 29: not payable yet while it waits for its rent, or (next month's) before
    // the invoice generation day — src/lib/invoiceRentReady.ts.
    const preparing = (await invoicesPreparing(invoice.resident_id, [invoice])).get(invoice.id);
    if (preparing) {
      return NextResponse.json({ error: preparing.reason === "electric" ? preparing.message : `This invoice is being prepared — it will be available to pay on ${preparing.until}.` }, { status: 400 });
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
    // Oct 28 (per Mely): a "Returned bank payment fee" line goes to MelyOS (below) and is not taxed.
    // Oct 28 (new model): the whole fee is never taxed; only MelyOS's part (if any) leaves the park's share.
    const { total: returnedFeesTotal, melyos: returnedAchFees } = await returnedAchFeeTotalsOnInvoices([invoice.id], resident?.company_id);
    // Oct 29 (live-money audit): whole cents (the webhook matches the tax line it adds against this).
    const taxAmount = taxEnabled ? Math.round(Math.max(totalAmount - returnedFeesTotal, 0) * (taxRatePercent / 100) * 100) / 100 : 0;

    const chargeAmount = Math.round((totalAmount + taxAmount + (passFeeToResident ? processingFee : 0)) * 100) / 100;

    // Oct 29 (live-money audit — Low): the park's own name and website (was always Aloha's).
    const { data: companyRow } = await supabase.from("companies").select("company_name, domain").eq("id", resident?.company_id || "").maybeSingle();
    const siteUrl = companyRow?.domain ? `https://${String(companyRow.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : (process.env.NEXT_PUBLIC_SITE_URL || "https://aloharvparkfl.com");

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(totalAmount * 100),
          product_data: {
            name: `${companyRow?.company_name || "RV Park"} Balance`,
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

    // Oct 28 (per Mely): the returned bank payment fee goes to MelyOS, not the park (never below $0).
    const alohaShare = Math.max(totalAmount + taxAmount + (passFeeToResident ? 0 : -processingFee) - returnedAchFees, 0);
    const connectSplit = resident?.company_id
      ? await resolveConnectSplit(resident.company_id, chargeAmount, alohaShare)
      : null;

    // Oct 21 (per Mely): no real payments on demo companies.
    { const demoBlocked = await demoPaymentBlock(resident?.company_id); if (demoBlocked) return demoBlocked; }
    // Oct 29 (live-money audit H1): refused without a payout account only when the owner turned it on.
    if (!connectSplit) { const refused = await unsplitRefusal(resident?.company_id, "invoice"); if (refused) return refused; }
    // Oct 29 (live-money audit M14): close other open checkouts (portal or guest) for this invoice.
    await closeOtherInvoiceCheckouts(stripe, { invoiceIds: [invoice.id], residentId: null });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      payment_intent_data: {
        metadata: parkShareMetadata(alohaShare), // Oct 29 (H1)
        ...(connectSplit
          ? {
              application_fee_amount: connectSplit.applicationFeeAmountCents,
              transfer_data: { destination: connectSplit.connectedAccountId },
              ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
            }
          : {}),
      },
      metadata: {
        ...parkShareMetadata(alohaShare),
        source: "guest_link",
        resident_id: invoice.resident_id,
        invoice_ids: invoice.id,
        processing_fee_charged: passFeeToResident ? String(processingFee) : "0",
        tax_charged: String(taxAmount),
        tax_rate_percent: String(taxRatePercent),
      },
      // Oct 28 (review): short-lived (Stripe minimum is 30 min) so an old link can't pay a balance that changed.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: `${siteUrl}/pay-invoice/${token}?paid=success`,
      cancel_url: `${siteUrl}/pay-invoice/${token}?paid=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    // Oct 28 (review): the returned-fee lookup failed — refuse rather than tax the fee or split it wrongly.
    if (err instanceof ReturnedFeeLookupError) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json(
      { error: err.message || "Could not create payment session." },
      { status: 500 }
    );
  }
}
