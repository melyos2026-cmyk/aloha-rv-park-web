// Oct 28 (per Mely): the written recurring-payment authorization for autopay BY BANK (ACH). Shared by
// the portal (shown before the resident continues) and /api/portal/bank-autopay (which stores this
// exact text, built on the server, as proof). Card autopay keeps its own text (AutopaySection.tsx).
// Oct 28 (per Mely): the returned-payment fee is a per-company rule (src/lib/returnedFeeRules.ts). The
// portal gets the company's own phrase from /api/portal/fee-settings (fees.returnFeePhrase), e.g. "a
// returned-payment fee of $29–$35 applies (…)" or "… of $15 or 5% of the payment, whichever is
// greater, applies". The Florida standard below is only the fallback until it loads.
// Client-safe (no server imports) — the portal components import it from here.
export const RV_RETURNED_ACH_FEE_PHRASE =
  "a returned-payment fee of $29–$35 applies (the returned-payment processing cost plus a service charge allowed by Florida law)";
export const RV_RETURNED_ACH_FEE_DISCLOSURE = `If your bank returns a payment, ${RV_RETURNED_ACH_FEE_PHRASE}.`;
export function returnedFeeSentence(phrase?: string | null) {
  return `If your bank returns a payment, ${phrase || RV_RETURNED_ACH_FEE_PHRASE}.`;
}

// returnFeePhrase: the company's rule (returnedFeePhrase). A number (older callers) means "use the default".
export function bankAutopayAuthorizationText(parkName: string, returnFeePhrase?: string | number | null) {
  const park = parkName || "the park";
  const phrase = typeof returnFeePhrase === "string" && returnFeePhrase ? returnFeePhrase : RV_RETURNED_ACH_FEE_PHRASE;
  return `I authorize ${park} to automatically debit this bank account (ACH) each month, on or after the due date, for the balance of my monthly invoice (rent, utilities, fees and any other charges on my resident account) plus the bank transfer fee shown in my resident portal, until I turn off autopay in my resident portal. Bank payments take 3–5 business days to clear. If my bank returns a payment, ${phrase}, it is added to my account, and autopay is turned off. Turning off autopay only stops future automatic payments and does not cancel any amount I owe.`;
}
