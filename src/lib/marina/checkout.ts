import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, resolveConnectSplit } from "@/lib/platformFee";
import type { MarinaCompany } from "./company";
import { isDemoDomain } from "./host";
import { round2 } from "./data";
import { recordMarinaOnlinePayment } from "./payments";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export type StartPaymentResult =
  | { ok: true; demo: true }
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

// Pays the remaining balance of ONE marina invoice.
//  - Demo marinas: no card is charged; the payment is recorded as a demo payment.
//  - Real marinas: Stripe Checkout with the same fee and Connect split rules as the RV parks.
// The caller is responsible for deciding WHO may pay this invoice.
export async function startInvoicePayment(p: {
  company: MarinaCompany;
  invoiceId: string;
  memberId?: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<StartPaymentResult> {
  const { company } = p;
  const { data: invoice } = await supabaseAdmin
    .from("marina_invoices")
    .select("id, invoice_number, description, amount, status")
    .eq("id", p.invoiceId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!invoice || invoice.status !== "open") return { ok: false, status: 404, error: "Invoice not found." };

  const { data: pays } = await supabaseAdmin
    .from("marina_invoice_payments")
    .select("amount, returned_at")
    .eq("company_id", company.id)
    .eq("invoice_id", invoice.id);
  const paid = (pays || []).filter((x) => !x.returned_at).reduce((s, x) => s + Number(x.amount), 0);
  const balance = round2(Number(invoice.amount) - paid);
  if (balance <= 0) return { ok: false, status: 400, error: "This invoice is already paid." };

  if (isDemoDomain(company.domain)) {
    const result = await recordMarinaOnlinePayment({
      companyId: company.id,
      invoiceId: invoice.id,
      amount: balance,
      reference: `demo:${crypto.randomUUID()}`,
      demo: true,
    });
    if (!result.ok) return { ok: false, status: 500, error: "Could not record the demo payment." };
    return { ok: true, demo: true };
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
        product_data: { name: `${company.company_name}: ${invoice.invoice_number}`, description: invoice.description },
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
        member_id: p.memberId || "",
        invoice_id: invoice.id,
        invoice_amount: String(balance),
        processing_fee_charged: passFee ? String(fee) : "0",
      },
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
    });
    if (!checkout.url) return { ok: false, status: 500, error: "Could not start payment." };
    return { ok: true, url: checkout.url };
  } catch (err: any) {
    return { ok: false, status: 500, error: err.message || "Could not start payment." };
  }
}
