// Oct 23 (per Mely): friendly names for marina invoice types (statements, receipts, summaries).
export const MARINA_CATEGORY: Record<string, string> = {
  slip_fee: "Dockage", event_room: "Event room", late_fee: "Late fee", application_fee: "Application",
  security_deposit: "Deposit", utility: "Shore power & utilities", returned_payment_fee: "Returned payment",
  fuel: "Fuel", store: "Store", other: "Other",
};
export const MARINA_METHOD: Record<string, string> = { card: "Card", cash: "Cash", check: "Check", ach: "ACH", money_order: "Money order", other: "Other" };
