import { NextResponse } from "next/server";
import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { isDemoDomain } from "@/lib/marina/host";
import { round2 } from "@/lib/marina/data";
import { recordMarinaOnlinePayment } from "@/lib/marina/payments";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/marina/pay  { invoice_id }
// Pays the remaining balance of ONE of the signed-in boater's own invoices.
//  - Demo marinas: no card is charged; the payment is recorded as a demo
//    payment so the whole flow can be shown safely.
//  - Real marinas: Stripe Checkout with the same fee and Connect split rules
//    as the RV parks. The Stripe webhook records the payment.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const session = getMarinaSession(req);
  if (!session || session.companyId !== company.id) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let invoiceId = "";
  try {
    invoiceId = String((await req.json()).invoice_id || "");
  } catch {}
  if (!invoiceId) return NextResponse.json({ error: "Missing invoice." }, { status: 400 });

  // The invoice must belong to this boater AND this marina.
  const { data: invoice } = await supabaseAdmin
    .from("marina_invoices")
    .select("id, invoice_number, description, amount, status, member_id")
    .eq("id", invoiceId)
    .eq("company_id", company.id)
    .eq("member_id", session.memberId)
    .maybeSingle();
  if (!invoice || invoice.status !== "open") {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data: pays } = await supabaseAdmin
    .from("marina_invoice_payments")
    .select("amount, returned_at")
    .eq("company_id", company.id)
    .eq("invoice_id", invoice.id);
  const paid = (pays || []).filter((p) => !p.returned_at).reduce((s, p) => s + Number(p.amount), 0);
  const balance = round2(Number(invoice.amount) - paid);
  if (balance <= 0) return NextResponse.json({ error: "This invoice is already paid." }, { status: 400 });

  if (isDemoDomain(company.domain)) {
    const result = await recordMarinaOnlinePayment({
      companyId: company.id,
      invoiceId: invoice.id,
      amount: balance,
      reference: `demo:${crypto.randomUUID()}`,
      demo: true,
    });
    if (!result.ok) return NextResponse.json({ error: "Could not record the demo payment." }, { status: 500 });
    return NextResponse.json({ ok: true, demo: true });
  }

  const { data: feeSettings } = await supabaseAdmin
    .from("company_fee_settings")
    .select("pass_processing_fee_to_resident")
    .eq("company_id", company.id)
    .maybeSingle();
  const passFee = feeSettings?.pass_processing_fee_to_resident !== false;
  const fee = round2(calculateProcessingFee(balance));
  const chargeAmount = round2(balance + (passFee ? fee : 0));

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: Math.round(balance * 100),
        product_data: { name: `${company.company_name} — ${invoice.invoice_number}`, description: invoice.description },
      },
    },
  ];
  if (passFee) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: Math.round(fee * 100), product_data: { name: "Card Processing Fee" } },
    });
  }

  const marinaShare = balance + (passFee ? 0 : -fee);
  const split = await resolveConnectSplit(company.id, chargeAmount, marinaShare);
  const origin = `https://${company.domain}`;

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      ...(split
        ? {
            payment_intent_data: {
              application_fee_amount: split.applicationFeeAmountCents,
              transfer_data: { destination: split.connectedAccountId },
              ...(split.statementDescriptorSuffix ? { statement_descriptor_suffix: split.statementDescriptorSuffix } : {}),
            },
          }
        : {}),
      metadata: {
        type: "marina_invoice",
        company_id: company.id,
        member_id: session.memberId,
        invoice_id: invoice.id,
        invoice_amount: String(balance),
        processing_fee_charged: passFee ? String(fee) : "0",
      },
      success_url: `${origin}/marina/account?paid=success`,
      cancel_url: `${origin}/marina/account?paid=cancelled`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not start payment." }, { status: 500 });
  }
}
