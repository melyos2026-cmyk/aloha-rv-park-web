import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { chargeRvCardAutopayInvoice, reconcileRvCardAutopay } from "@/lib/rvCardAutopay";
import { isInvoicePayableNow } from "@/lib/invoicePayable";
import { invoicesAwaitingRent } from "@/lib/invoiceRentReady";
import { chargeRvBankAutopay, reconcileRvBankAutopay } from "@/lib/rvBankAutopay";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/process-autopay
// Runs daily. Charges any Pending resident_invoices for residents who have
// autopay_enabled + a saved card, once the invoice's due date has arrived.
// Oct 28: residents whose saved method is a bank account go through src/lib/rvBankAutopay.ts.
// Uses Stripe's off_session confirmation (the resident isn't present) with
// their saved payment method.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  // Oct 26 (security review): fail closed — with CRON_SECRET unset, "Bearer undefined" used to work.
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayStr = new Date().toISOString().split("T")[0];

  // Oct 28 (per Mely): bank autopay — first settle/fail bank payments that cleared or were returned
  // (asks Stripe, so it works even if the payment_intent.* webhook events are not enabled).
  const bankReconcile = await reconcileRvBankAutopay().catch((e: any) => ({ settled: 0, failed: 0, error: e?.message }));
  // Oct 29 (live-money audit M1): same for card autopay — finish charges/claims an earlier run left open.
  const cardReconcile = await reconcileRvCardAutopay().catch((e: any) => ({ finished: 0, released: 0, error: e?.message }));

  // Oct 28: "*" so a database where autopay_method (rv_ach_autopay.sql) doesn't exist yet still works.
  const { data: autopayResidents, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("*")
    .eq("autopay_enabled", true)
    .not("stripe_customer_id", "is", null)
    .not("stripe_payment_method_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let chargedCount = 0;
  let failedCount = 0;
  const bank: Record<string, number> = {};
  const card: Record<string, number> = {};

  for (const resident of autopayResidents || []) {
    // Oct 28 (per Mely): autopay by bank (ACH). The saved method decides: autopay_method, or — when
    // that column is empty/missing — the saved Stripe payment method's own type. If the type can't
    // be read today, the resident is skipped (never charge a bank account through the card path).
    let method: string | null = resident.autopay_method === "ach" || resident.autopay_method === "card" ? resident.autopay_method : null;
    if (!method) {
      const pm = await stripe.paymentMethods.retrieve(resident.stripe_payment_method_id!).catch((e: any) => {
        console.error(`process-autopay: could not read the saved payment method of resident ${resident.id} — skipped today:`, e?.message);
        return null;
      });
      if (!pm) { failedCount += 1; continue; }
      method = pm.type === "us_bank_account" ? "ach" : "card";
    }
    if (method === "ach") {
      const r = await chargeRvBankAutopay(resident, todayStr).catch((e: any) => ({ status: "failed" as const, detail: e?.message }));
      bank[r.status] = (bank[r.status] || 0) + 1;
      if (r.status === "processing" || r.status === "succeeded") chargedCount += 1;
      if (r.status === "failed") failedCount += 1;
      continue; // never falls back to card
    }

    // Aug 6 (per Mely): same processing-fee/tax/Connect-split model as the manual "Pay Now" route.
    // Oct 29 (live-money audit M1): the card path now claims each invoice first (Pending → Processing,
    // like bank autopay), checks the Paid update, carries metadata (company_id, resident_id,
    // invoice_ids, type rv_autopay_card) and tells System Health about failures — see
    // src/lib/rvCardAutopay.ts. Interrupted runs are finished by reconcileRvCardAutopay above.
    const { data: invoices, error: invErr } = await supabaseAdmin
      .from("resident_invoices")
      .select("id, total_amount, due_date, invoice_month")
      .eq("resident_id", resident.id)
      .eq("status", "Pending")
      .lte("due_date", todayStr);
    if (invErr) { failedCount += 1; continue; }
    // Oct 28 (review): skip this month's invoice until the rent is on it (src/lib/invoiceRentReady.ts).
    const awaitingRent = await invoicesAwaitingRent(resident.id, (invoices || []).map((i) => ({ ...i, status: "Pending" })));

    for (const invoice of invoices || []) {
      if (awaitingRent.has(invoice.id)) continue;
      if (!(Number(invoice.total_amount || 0) > 0)) continue;
      // Oct 28 (review): never charge a future month's invoice early (rent is added to it later).
      if (!isInvoicePayableNow(invoice.invoice_month)) continue;
      const r = await chargeRvCardAutopayInvoice(resident as any, invoice, todayStr).catch((e: any) => ({ status: "failed" as const, detail: e?.message }));
      card[r.status] = (card[r.status] || 0) + 1;
      if (r.status === "charged") chargedCount += 1;
      if (r.status === "failed") { failedCount += 1; break; } // autopay was turned off: stop for this resident
      if (r.status === "unknown") break; // don't stack charges while one is unconfirmed
    }
  }

  return NextResponse.json({ success: true, chargedCount, failedCount, card, bank, bankReconcile, cardReconcile });
}
