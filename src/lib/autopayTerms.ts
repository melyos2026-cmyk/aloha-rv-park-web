// Oct 28 (per Mely): the written recurring-payment authorization for autopay BY BANK (ACH). Shared by
// the portal (shown before the resident continues) and /api/portal/bank-autopay (which stores this
// exact text, built on the server, as proof). Card autopay keeps its own text (AutopaySection.tsx).
// Oct 28 (per Mely — owner-approved tiered fee, RV parks): the returned-payment disclosure shown to RV
// residents everywhere bank payments are offered. The amount is computed by rvReturnedAchFee
// (src/lib/platformFee.ts): $4 bank fee + Fla. Stat. 68.065 service charge ($25/$30/$31).
// Client-safe (no server imports) — the portal components import it from here.
export const RV_RETURNED_ACH_FEE_DISCLOSURE =
  "If your bank returns a payment, a returned-payment fee of $29–$35 applies ($4 bank fee plus a service charge allowed by Florida law).";

// (The second argument is kept for older callers and no longer used — the fee is tiered now.)
export function bankAutopayAuthorizationText(parkName: string, _returnFee?: number) {
  const park = parkName || "the park";
  return `I authorize ${park} to automatically debit this bank account (ACH) each month, on or after the due date, for the balance of my monthly invoice (rent, utilities, fees and any other charges on my resident account) plus the bank transfer fee shown in my resident portal, until I turn off autopay in my resident portal. Bank payments take 3–5 business days to clear. If my bank returns a payment, a returned-payment fee of $29–$35 applies ($4 bank fee plus a service charge allowed by Florida law), it is added to my account, and autopay is turned off. Turning off autopay only stops future automatic payments and does not cancel any amount I owe.`;
}
