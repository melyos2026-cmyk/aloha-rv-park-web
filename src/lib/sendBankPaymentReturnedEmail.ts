import { supabaseAdmin } from "@/lib/supabase-admin";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";
import { brandedEmailHtml, escapeHtml, loadEmailBrand, money, sendBrandedEmail } from "@/lib/residentEmailLayout";

// Oct 28 (per Mely): tells the RESIDENT that their bank (ACH) payment did not go through — bank
// autopay (returned by the bank, or refused before it was sent) and one-time bank checkout returns.
// Sent ONCE per payment: a per-payment marker in stripe_processed_events
// ("rv_ach_return_email:<payment id>", source "rv_autopay"). The callers only reach this after their
// own per-payment dedupe (System Health issue / fail claim), so this marker is a second guard.
// Never for demo companies. Best-effort: never throws.

// Stripe ACH return / decline codes → plain words for the resident.
const ACH_REASONS: Record<string, string> = {
  insufficient_funds: "there were not enough funds in the account",
  account_closed: "the bank account is closed",
  bank_account_closed: "the bank account is closed",
  no_account: "the bank could not find the account",
  bank_account_unusable: "the bank account can't be used for this payment",
  invalid_account_number: "the account number is not valid",
  account_frozen: "the bank account is frozen",
  bank_account_frozen: "the bank account is frozen",
  bank_account_restricted: "the bank account has restrictions on it",
  debit_not_authorized: "the bank says the payment was not authorized",
  debit_authorization_not_match: "the bank says the payment was not authorized",
  bank_ownership_changed: "the account's ownership changed",
  bank_account_blocked: "the bank blocked the payment",
  payment_method_microdeposit_verification_attempts_exceeded: "the bank account could not be verified",
  payment_method_unactivated: "the bank account is not active",
};

export function plainAchReason(code?: string | null, message?: string | null): string {
  const c = String(code || "").toLowerCase();
  if (c && ACH_REASONS[c]) return ACH_REASONS[c];
  const m = String(message || "").toLowerCase();
  for (const [k, v] of Object.entries(ACH_REASONS)) if (m.includes(k.replace(/_/g, " "))) return v;
  if (/insufficient/.test(m)) return ACH_REASONS.insufficient_funds;
  if (/closed/.test(m)) return ACH_REASONS.account_closed;
  if (/authoriz/.test(m)) return ACH_REASONS.debit_not_authorized;
  return "";
}

export async function sendBankPaymentReturnedEmail(p: {
  paymentRef: string; // PaymentIntent id (autopay) or Checkout Session id (one-time) — the dedupe key
  residentId: string;
  companyId: string;
  amount: number;
  invoiceLabels: string[]; // e.g. invoice months that are owed again
  invoicesOwedAgain: boolean; // some invoice of this payment is open (Pending) again right now
  returnedByBank: boolean; // true: sent to the bank and returned; false: refused before it was sent
  reasonCode?: string | null;
  reasonMessage?: string | null;
  feeAdded: boolean; // the returned-payment fee was really added
  feeAmount?: number; // total fee added (RV: $29–$35, see rvReturnedAchFee)
  feeBankPart?: number; // $4.00 bank fee part
  feeServicePart?: number; // Fla. Stat. 68.065 service charge part
  feeExplanation?: string; // custom fee schedules: e.g. "Returned payment fee per City Marina fee schedule"
  autopayTurnedOff: boolean; // autopay was really switched off
  isAutopay: boolean;
}): Promise<void> {
  try {
    const brand = await loadEmailBrand(p.companyId);
    if (!brand || brand.isDemo) return;
    const { data: resident } = await supabaseAdmin
      .from("resident_accounts")
      .select("full_name, email, company_id")
      .eq("id", p.residentId)
      .maybeSingle();
    if (!resident?.email || resident.company_id !== p.companyId) return;

    const marker = `rv_ach_return_email:${p.paymentRef}`;
    if ((await claimStripeEvent(marker, "rv_autopay")) === "duplicate") return;

    const reason = plainAchReason(p.reasonCode, p.reasonMessage);
    const what = p.isAutopay ? "automatic bank payment (autopay)" : "bank payment";
    const invoices = p.invoiceLabels.filter(Boolean);
    const invoiceText = invoices.length
      ? `${invoices.length === 1 ? "invoice" : "invoices"} for <strong>${invoices.map(escapeHtml).join(", ")}</strong>`
      : "invoice(s) it was paying";

    const items: string[] = [];
    if (p.invoicesOwedAgain) items.push(`<li>The ${invoiceText} ${invoices.length === 1 ? "is" : "are"} <strong>owed again</strong>.</li>`);
    if (p.feeAdded) {
      const parts = p.feeBankPart != null && p.feeServicePart != null
        ? ` (${money(p.feeBankPart)} bank fee plus a ${money(p.feeServicePart)} service charge allowed by Florida law)`
        : p.feeExplanation ? ` (${escapeHtml(p.feeExplanation.replace(/^Returned payment fee /, ""))})` : "";
      items.push(`<li>A <strong>${money(p.feeAmount ?? 0)}</strong> returned-payment fee${parts} was added to your balance.</li>`);
    }
    if (p.autopayTurnedOff) items.push(`<li>Bank <strong>autopay was turned off</strong>, so the same account won't be charged again automatically.</li>`);

    const bodyHtml = `
      <p style="margin:0 0 12px 0;">Hi ${escapeHtml(resident.full_name || "there")},</p>
      <p style="margin:0 0 12px 0;">${p.returnedByBank
        ? `Your ${what} of <strong>${money(p.amount)}</strong> was <strong>returned by your bank</strong>${reason ? ` because ${escapeHtml(reason)}` : ""}. The money was not collected.`
        : `Your ${what} of <strong>${money(p.amount)}</strong> could not be processed — your bank refused it before it was sent${reason ? ` (${escapeHtml(reason)})` : ""}. Nothing was taken from your account.`}</p>
      ${items.length ? `<p style="margin:0 0 6px 0;">What this means:</p>
      <ul style="margin:0 0 12px 0; padding-left:20px;">${items.join("")}</ul>` : ""}
      <p style="margin:0 0 12px 0;">Please log in to your resident portal to pay${p.autopayTurnedOff || p.isAutopay ? " or set up autopay again" : ""}. If you think this is a mistake, check with your bank first, then contact the office — we're happy to help.</p>`;

    const html = brandedEmailHtml(brand, {
      title: p.returnedByBank ? "Your bank payment was returned" : "Your bank payment didn't go through",
      bodyHtml,
      button: { label: p.autopayTurnedOff || p.isAutopay ? "Pay now or set up autopay" : "Pay now", url: brand.portalUrl },
    });
    const ok = await sendBrandedEmail(
      brand,
      resident.email,
      `${p.returnedByBank ? "Bank payment returned" : "Bank payment not processed"} — ${money(p.amount)}`,
      html,
    );
    await finishStripeEvent(marker, "rv_autopay", ok); // not sent → claim released (a later retry may send it)
  } catch (e: any) {
    console.error("sendBankPaymentReturnedEmail:", e?.message);
  }
}
