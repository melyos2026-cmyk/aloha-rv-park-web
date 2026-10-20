// Oct 19 (per Mely — Twilio A2P 10DLC): the exact SMS opt-in wording, shared
// by the checkbox (client) and the consent records (server). Plain module so
// both sides can import it.
export function smsConsentWording(parkName: string) {
  return (
    `I agree to receive text messages from ${parkName} about my account, such as invoices, ` +
    `payment notices, rental application invitations and reservation confirmations. ` +
    `Message frequency varies. Message and data rates may apply. Reply STOP to opt out, ` +
    `HELP for help. Consent is not a condition of any rental or purchase.`
  );
}
