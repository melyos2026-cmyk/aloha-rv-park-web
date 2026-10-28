// Oct 28 (per Mely): the written recurring-payment authorization for autopay BY BANK (ACH). Shared by
// the portal (shown before the resident continues) and /api/portal/bank-autopay (which stores this
// exact text, built on the server, as proof). Card autopay keeps its own text (AutopaySection.tsx).
export function bankAutopayAuthorizationText(parkName: string, returnFee = 4) {
  const park = parkName || "the park";
  return `I authorize ${park} to automatically debit this bank account (ACH) each month, on or after the due date, for the balance of my monthly invoice (rent, utilities, fees and any other charges on my resident account) plus the bank transfer fee shown in my resident portal, until I turn off autopay in my resident portal. Bank payments take 3–5 business days to clear. If my bank returns a payment, a $${returnFee.toFixed(2)} returned-payment fee is added to my account and autopay is turned off. Turning off autopay only stops future automatic payments and does not cancel any amount I owe.`;
}
