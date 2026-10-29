import { demoPaymentBlock } from "@/lib/demoPayments";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { calculateProcessingFee, calculateAchFee, resolveConnectSplit, returnedAchFeesOnInvoices, returnedFeeRuleToDisclose } from "@/lib/platformFee";
import { achAllowed } from "@/lib/marina/checkout";
import { isInvoicePayableNow } from "@/lib/invoicePayable";
import { invoicesAwaitingRent } from "@/lib/invoiceRentReady";
import { requireMatchingSession } from "@/lib/portalSession";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// resident_payments (the legacy billing table) has been fully unified into
// resident_invoices — this route now only ever charges pending invoices.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { residentId } = body;
    // Oct 28 (per Mely): residents may pay by bank (ACH) — far cheaper for them. Default is card.
    const ach = body?.method === "ach";

    if (!residentId) {
      return NextResponse.json({ error: "Missing resident ID" }, { status: 400 });
    }

    // Oct 20 (security review): anyone could start a checkout for ANY
    // resident's pending invoices just by knowing their id. Only the
    // signed-in resident's own portal session may do this now. (The
    // no-login guest invoice link uses create-guest-invoice-checkout,
    // which is unaffected.)
    const authError = await requireMatchingSession(req, residentId);
    if (authError) return authError;

    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("company_id")
      .eq("id", residentId)
      .maybeSingle();

    const { data: pendingRows, error: invoicesError } = await supabase
      .from("resident_invoices")
      .select("*")
      .eq("resident_id", residentId)
      .eq("status", "Pending");

    if (invoicesError) {
      return NextResponse.json({ error: invoicesError.message }, { status: 400 });
    }

    // Oct 28 (review): a future month's invoice (e.g. next month's electric-only invoice) is not
    // payable until that month starts — see src/lib/invoicePayable.ts.
    const monthPayable = (pendingRows || []).filter((inv) => isInvoicePayableNow(inv.invoice_month));
    // Oct 28 (review): this month's invoice isn't payable until the rent is on it (src/lib/invoiceRentReady.ts).
    const awaitingRent = await invoicesAwaitingRent(residentId, monthPayable);
    const invoices = monthPayable.filter((inv) => !awaitingRent.has(inv.id));

    const totalAmount = (invoices || []).reduce(
      (sum, invoice) => sum + Number(invoice.total_amount || 0),
      0
    );

    if (totalAmount <= 0) {
      if (awaitingRent.size > 0) {
        const when = Array.from(awaitingRent.values())[0];
        return NextResponse.json({ error: `Your invoice is being prepared — it will be available to pay after rent is added on ${when}.` }, { status: 400 });
      }
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
      .select("pass_processing_fee_to_resident, ach_enabled, ach_min_amount")
      .eq("company_id", resident?.company_id || "")
      .maybeSingle();

    // Oct 28 (per Mely): bank (ACH) only when the park allows it and the balance is at or above
    // its minimum (default $100) — same rule as the marina checkout.
    // Oct 28 (per Mely): RV parks must have bank payments explicitly ON (ach_enabled === true).
    if (ach && (feeSettings?.ach_enabled !== true || !achAllowed(feeSettings, totalAmount))) {
      const min = Number(feeSettings?.ach_min_amount ?? 100);
      return NextResponse.json(
        {
          error: feeSettings?.ach_enabled !== true
            ? "Bank payment is not available at this park. Please pay by card."
            : `Bank payment is available on balances of $${(Number.isFinite(min) ? min : 100).toFixed(2)} or more. Please pay by card.`,
        },
        { status: 400 }
      );
    }

    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;
    const processingFee = ach
      ? Math.round(calculateAchFee(totalAmount) * 100) / 100
      : calculateProcessingFee(totalAmount);

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
    // Oct 28 (per Mely): a "Returned bank payment fee" line is Stripe's charge to MelyOS — it goes to
    // MelyOS's application fee (below) and is not taxed.
    const returnedAchFees = await returnedAchFeesOnInvoices(invoiceIds, resident?.company_id);
    const taxAmount = taxEnabled ? Math.max(totalAmount - returnedAchFees, 0) * (taxRatePercent / 100) : 0;

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
          product_data: { name: ach ? "Bank Transfer Fee" : "Card Processing Fee" },
        },
      });
    }

    // Aloha's share is the full invoice amount PLUS all of the tax
    // (theirs to remit) — MelyOS's cut is only the processing fee, taken
    // from the resident's payment if they're covering it, or otherwise
    // out of the park's own invoice amount.
    // Oct 28 (per Mely): the returned bank payment fee goes to MelyOS, not the park (never below $0).
    const alohaShare = Math.max(totalAmount + taxAmount + (passFeeToResident ? 0 : -processingFee) - returnedAchFees, 0);
    const connectSplit = resident?.company_id
      ? await resolveConnectSplit(resident.company_id, chargeAmount, alohaShare)
      : null;

    // Oct 21 (per Mely): no real payments on demo companies.
    { const demoBlocked = await demoPaymentBlock(resident?.company_id); if (demoBlocked) return demoBlocked; }

    // Oct 28 (review — double charge): close this resident's earlier checkouts that are still open, so
    // an old tab can't pay the same invoices a second time. Stripe can't search sessions by metadata,
    // so this lists open sessions from the last 24 hours (new ones expire after 31 minutes anyway).
    try {
      const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
      let seen = 0;
      for await (const old of stripe.checkout.sessions.list({ status: "open", created: { gte: since }, limit: 100 })) {
        if (++seen > 1000) break;
        // Only portal checkouts (metadata.source "portal") — never a guest-link checkout someone else opened.
        if (old.metadata?.source === "portal" && old.metadata?.resident_id === residentId && !old.metadata?.type && old.metadata?.invoice_ids) {
          await stripe.checkout.sessions.expire(old.id).catch(() => null);
        }
      }
    } catch (e: any) {
      console.error("create-checkout-session: could not expire earlier sessions:", e?.message);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ach ? ["us_bank_account"] : ["card"],
      ...(ach ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "instant" } } } : {}),
      line_items: lineItems,
      ...(connectSplit
        ? {
            payment_intent_data: {
              application_fee_amount: connectSplit.applicationFeeAmountCents,
              transfer_data: { destination: connectSplit.connectedAccountId },
              ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
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
        // Oct 28: the webhook marks the invoices "Processing" until the bank confirms.
        payment_method: ach ? "ach" : "card",
        source: "portal",
        // Oct 28 (review): the returned-payment fee rule shown to the payer now (used if the bank returns it).
        ...(ach ? { returned_fee_rule: await returnedFeeRuleToDisclose("rv", resident?.company_id || null) } : {}),
      },
      // Oct 28 (review): short-lived (Stripe minimum is 30 min) so an old link can't pay a balance that changed.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
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

