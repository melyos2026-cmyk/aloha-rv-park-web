import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, calculateAchFee, resolveConnectSplit, returnedFeeRuleToDisclose } from "@/lib/platformFee";
import type { MarinaCompany } from "./company";
import { isDemoCompany } from "./host";
import { round2 } from "./data";
import { recordMarinaOnlinePayment } from "./payments";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { marinaReturnedFeeMelyosPart } from "./returnedFee";

// Oct 24 (per Mely — security run): a real marina must have its own connected Stripe account.
// Without one the money would sit in MelyOS's balance (public money, for a city marina), so
// online payment is refused and flagged instead.
async function noConnectedAccount(company: MarinaCompany) {
  await logSystemHealthIssue({ companyId: company.id, issueType: "marina_online_payment_failed", source: "stripe", message: `${company.company_name} tried to take an online payment but has no connected Stripe account. Finish Stripe Connect onboarding for this marina.` }).catch(() => null);
  return { ok: false as const, status: 503, error: "Online payments aren't set up for this marina yet. Please pay at the office." };
}

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
  hold?: boolean;            // Oct 27: card hold (authorize now, charge later) — resident rate under review
}): Promise<StartPaymentResult> {
  const { company } = p;
  const { data: invoice } = await supabaseAdmin
    .from("marina_invoices")
    .select("*")
    .eq("id", p.invoiceId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!invoice || invoice.status !== "open") return { ok: false, status: 404, error: "Invoice not found." };
  // Oct 27: a booking on a card hold is charged by the hold, never paid a second time
  if ((invoice as any).on_hold && !p.hold) return { ok: false, status: 409, error: "This booking is on a card hold and will be charged automatically." };

  const { data: pays } = await supabaseAdmin
    .from("marina_invoice_payments")
    .select("amount, returned_at")
    .eq("company_id", company.id)
    .eq("invoice_id", invoice.id);
  const paid = (pays || []).filter((x) => !x.returned_at).reduce((s, x) => s + Number(x.amount), 0);
  const balance = round2(Number(invoice.amount) - paid);
  if (balance <= 0) return { ok: false, status: 400, error: "This invoice is already paid." };

  if (isDemoCompany(company)) {
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
  const ach = p.method === "ach" && !p.hold; // a hold is always a card
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

  // Oct 28 (per Mely): MelyOS's share of a returned-payment fee invoice goes to MelyOS, not the marina.
  const returnedFeeMelyos = await marinaReturnedFeeMelyosPart(company.id, [{ id: invoice.id, balance }]);
  const marinaShare = Math.max(balance + (passFee ? 0 : -fee) - returnedFeeMelyos, 0);
  const split = await resolveConnectSplit(company.id, chargeAmount, marinaShare);
  if (!split) return noConnectedAccount(company);

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ach ? ["us_bank_account"] : ["card"],
      ...(ach ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } } } : {}),
      line_items: lineItems,
      ...(split
        ? {
            payment_intent_data: {
              ...(p.hold ? { capture_method: "manual" as const } : {}),
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
        ...(p.hold ? { hold: "1" } : {}),
        ...(ach ? { returned_fee_rule: await returnedFeeRuleToDisclose("marina", company.id) } : {}), // Oct 28: rule shown now
      },
      // Oct 24: short-lived checkout (Stripe minimum is 30 min) so an old link can't pay a balance that changed.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
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
  const { data: invoices0 } = await supabaseAdmin.from("marina_invoices").select("*")
    .eq("company_id", company.id).in("id", ids).eq("status", "open").order("due_date");
  const invoices = (invoices0 || []).filter((i: any) => !i.on_hold); // Oct 27: card-hold bookings are charged by the hold
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at").eq("company_id", company.id).in("invoice_id", ids);
  const paidBy: Record<string, number> = {};
  (pays || []).forEach((x: any) => { if (!x.returned_at) paidBy[x.invoice_id] = (paidBy[x.invoice_id] || 0) + Number(x.amount); });
  const rows = (invoices || []).map((i: any) => ({ ...i, balance: round2(Number(i.amount) - (paidBy[i.id] || 0)) })).filter((i) => i.balance > 0);
  if (!rows.length) return { ok: false, status: 400, error: "These invoices are already paid." };
  if (rows.length === 1) return startInvoicePayment({ company, invoiceId: rows[0].id, memberId: p.memberId, successUrl: p.successUrl, cancelUrl: p.cancelUrl, method: p.method });
  const total = round2(rows.reduce((a, r) => a + r.balance, 0));

  if (isDemoCompany(company)) {
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
  const returnedFeeMelyos = await marinaReturnedFeeMelyosPart(company.id, rows.map((r) => ({ id: r.id, balance: r.balance }))); // Oct 28
  const split = await resolveConnectSplit(company.id, chargeAmount, Math.max(total + (passFee ? 0 : -fee) - returnedFeeMelyos, 0));
  if (!split) return noConnectedAccount(company);
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
        ...(ach ? { returned_fee_rule: await returnedFeeRuleToDisclose("marina", company.id) } : {}), // Oct 28: rule shown now
      },
      // Oct 24: short-lived checkout (Stripe minimum is 30 min) so an old link can't pay a balance that changed.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
    });
    if (!checkout.url) return { ok: false, status: 500, error: "Could not start payment." };
    return { ok: true, url: checkout.url };
  } catch (err: any) {
    return { ok: false, status: 500, error: err.message || "Could not start payment." };
  }
}
