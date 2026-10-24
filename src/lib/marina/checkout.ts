import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, calculateAchFee, resolveConnectSplit } from "@/lib/platformFee";
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
  method?: "card" | "ach";   // Oct 24: bank transfer (ACH) — allowed only above the marina's minimum
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
      method: p.method === "ach" ? "ach" : "card",
    });
    if (!result.ok) return { ok: false, status: 500, error: "Could not record the demo payment." };
    return { ok: true, demo: true };
  }

  const { data: feeSettings } = await supabaseAdmin
    .from("company_fee_settings")
    .select("pass_processing_fee_to_resident, ach_enabled, ach_min_amount")
    .eq("company_id", company.id)
    .maybeSingle();
  const passFee = feeSettings?.pass_processing_fee_to_resident !== false;
  const ach = p.method === "ach";
  if (ach && !achAllowed(feeSettings, balance)) return { ok: false, status: 400, error: "Bank payment is not available for this invoice. Please pay by card." };
  const fee = round2(ach ? calculateAchFee(balance) : calculateProcessingFee(balance));
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
      price_data: { currency: "usd", unit_amount: Math.round(fee * 100), product_data: { name: ach ? "Bank Transfer Fee" : "Card Processing Fee" } },
    });
  }

  const marinaShare = balance + (passFee ? 0 : -fee);
  const split = await resolveConnectSplit(company.id, chargeAmount, marinaShare);

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ach ? ["us_bank_account"] : ["card"],
      ...(ach ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } } } : {}),
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
        payment_method: ach ? "ach" : "card",
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

// Oct 24: bank (ACH) payments are offered when the marina allows them and the balance is at
// or above its minimum (default $100). Demo marinas offer it too so the flow can be shown.
export function achAllowed(settings: { ach_enabled?: boolean | null; ach_min_amount?: number | string | null } | null | undefined, balance: number): boolean {
  if (settings?.ach_enabled === false) return false;
  const min = Number(settings?.ach_min_amount ?? 100);
  return balance >= (Number.isFinite(min) ? min : 100);
}

// Oct 24 (per Mely): "Pay balance" — pay several of a boater's invoices in ONE card or bank payment.
// One Stripe charge (one fee), split back onto each invoice when the payment is recorded.
// The caller checks the invoices belong to the boater. Up to 10 invoices per payment (Stripe
// metadata size), oldest first.
export const MAX_INVOICES_PER_PAYMENT = 10;
export async function startMultiInvoicePayment(p: {
  company: MarinaCompany;
  invoiceIds: string[];
  memberId?: string | null;
  successUrl: string;
  cancelUrl: string;
  method?: "card" | "ach";
}): Promise<StartPaymentResult> {
  const { company } = p;
  const ids = [...new Set(p.invoiceIds)].slice(0, MAX_INVOICES_PER_PAYMENT);
  if (!ids.length) return { ok: false, status: 400, error: "Choose the invoices to pay." };
  const { data: invoices } = await supabaseAdmin.from("marina_invoices").select("id, invoice_number, description, amount, status, due_date")
    .eq("company_id", company.id).in("id", ids).eq("status", "open").order("due_date");
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at").eq("company_id", company.id).in("invoice_id", ids);
  const paidBy: Record<string, number> = {};
  (pays || []).forEach((x: any) => { if (!x.returned_at) paidBy[x.invoice_id] = (paidBy[x.invoice_id] || 0) + Number(x.amount); });
  const rows = (invoices || []).map((i: any) => ({ ...i, balance: round2(Number(i.amount) - (paidBy[i.id] || 0)) })).filter((i) => i.balance > 0);
  if (!rows.length) return { ok: false, status: 400, error: "These invoices are already paid." };
  if (rows.length === 1) return startInvoicePayment({ company, invoiceId: rows[0].id, memberId: p.memberId, successUrl: p.successUrl, cancelUrl: p.cancelUrl, method: p.method });
  const total = round2(rows.reduce((a, r) => a + r.balance, 0));

  if (isDemoDomain(company.domain)) {
    const ref = `demo:${crypto.randomUUID()}`;
    for (let i = 0; i < rows.length; i++) {
      const r = await recordMarinaOnlinePayment({ companyId: company.id, invoiceId: rows[i].id, amount: rows[i].balance, reference: `${ref}:${i + 1}`, demo: true, method: p.method === "ach" ? "ach" : "card" });
      if (!r.ok) return { ok: false, status: 500, error: "Could not record the demo payment." };
    }
    return { ok: true, demo: true };
  }

  const { data: feeSettings } = await supabaseAdmin.from("company_fee_settings").select("pass_processing_fee_to_resident, ach_enabled, ach_min_amount").eq("company_id", company.id).maybeSingle();
  const passFee = feeSettings?.pass_processing_fee_to_resident !== false;
  const ach = p.method === "ach";
  if (ach && !achAllowed(feeSettings, total)) return { ok: false, status: 400, error: "Bank payment is not available for this amount. Please pay by card." };
  const fee = round2(ach ? calculateAchFee(total) : calculateProcessingFee(total));
  const chargeAmount = round2(total + (passFee ? fee : 0));
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = rows.map((r) => ({
    quantity: 1,
    price_data: { currency: "usd", unit_amount: Math.round(r.balance * 100), product_data: { name: `${company.company_name}: ${r.invoice_number}`, description: String(r.description || "").slice(0, 300) || undefined } },
  }));
  if (passFee) lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(fee * 100), product_data: { name: ach ? "Bank Transfer Fee" : "Card Processing Fee" } } });
  const split = await resolveConnectSplit(company.id, chargeAmount, total + (passFee ? 0 : -fee));
  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ach ? ["us_bank_account"] : ["card"],
      ...(ach ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } } } : {}),
      line_items: lineItems,
      ...(split ? { payment_intent_data: { application_fee_amount: split.applicationFeeAmountCents, transfer_data: { destination: split.connectedAccountId }, ...(split.statementDescriptorSuffix ? { statement_descriptor_suffix: split.statementDescriptorSuffix } : {}) } } : {}),
      metadata: {
        type: "marina_invoices",
        company_id: company.id,
        member_id: p.memberId || "",
        allocs: rows.map((r) => `${r.id}:${r.balance.toFixed(2)}`).join(";"),
        invoice_amount: String(total),
        processing_fee_charged: passFee ? String(fee) : "0",
        payment_method: ach ? "ach" : "card",
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
