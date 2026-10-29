import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { calculateProcessingFee, resolveConnectSplit, returnedAchFeeTotalsOnInvoices } from "@/lib/platformFee";
import { logRvOnlinePayment } from "@/lib/logRvOnlinePayment";
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

    // Aug 6 (per Mely): same processing-fee/tax/Connect-split model as the
    // manual "Pay Now" route (create-checkout-session) — found via a real
    // live-mode audit that this cron was charging the raw invoice total
    // straight to MelyOS's own account, with NO split to the park and NO
    // processing fee at all, unlike every other charge in the system.
    const { data: feeSettings } = await supabaseAdmin
      .from("company_fee_settings")
      .select("pass_processing_fee_to_resident")
      .eq("company_id", resident.company_id || "")
      .maybeSingle();
    const passFeeToResident = feeSettings?.pass_processing_fee_to_resident !== false;

    const { data: taxSettings } = await supabaseAdmin
      .from("company_tax_settings")
      .select("enable_tax, manual_tax_rate_percent, rent_tax_mode")
      .eq("company_id", resident.company_id || "")
      .maybeSingle();
    const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
    const taxEnabled =
      !!taxSettings?.enable_tax && taxRatePercent > 0 && taxSettings?.rent_tax_mode === "excluded";

    const { data: invoices } = await supabaseAdmin
      .from("resident_invoices")
      .select("id, total_amount, due_date, invoice_month")
      .eq("resident_id", resident.id)
      .eq("status", "Pending")
      .lte("due_date", todayStr);
    // Oct 28 (review): skip this month's invoice until the rent is on it (src/lib/invoiceRentReady.ts).
    const awaitingRent = await invoicesAwaitingRent(resident.id, (invoices || []).map((i) => ({ ...i, status: "Pending" })));

    for (const invoice of invoices || []) {
      if (awaitingRent.has(invoice.id)) continue;
      const amount = Number(invoice.total_amount || 0);
      if (amount <= 0) continue;
      // Oct 28 (review): never charge a future month's invoice early (rent is added to it later).
      if (!isInvoicePayableNow(invoice.invoice_month)) continue;

      // Oct 28 (per Mely): a "Returned bank payment fee" line goes to MelyOS (below) and is not taxed.
      // Oct 28 (new model): the whole fee is never taxed; only MelyOS's part (if any) leaves the park's share.
      // Lookup failed → not charged today (System Health told); tomorrow's run tries again.
      let feeTotals: { total: number; melyos: number };
      try { feeTotals = await returnedAchFeeTotalsOnInvoices([invoice.id], resident.company_id); } catch { continue; }
      const { total: returnedFeesTotal, melyos: returnedAchFees } = feeTotals;
      const taxAmount = taxEnabled ? Math.max(amount - returnedFeesTotal, 0) * (taxRatePercent / 100) : 0;
      const processingFee = calculateProcessingFee(amount);
      const chargeAmount = amount + taxAmount + (passFeeToResident ? processingFee : 0);
      // Aloha's share is the full invoice amount plus all tax (theirs to
      // remit) — MelyOS's cut is only the processing fee.
      // Oct 28 (per Mely): the returned bank payment fee goes to MelyOS, not the park (never below $0).
      const alohaShare = Math.max(amount + taxAmount + (passFeeToResident ? 0 : -processingFee) - returnedAchFees, 0);
      const connectSplit = resident.company_id
        ? await resolveConnectSplit(resident.company_id, chargeAmount, alohaShare)
        : null;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(chargeAmount * 100),
          currency: "usd",
          customer: resident.stripe_customer_id!,
          payment_method: resident.stripe_payment_method_id!,
          off_session: true,
          confirm: true,
          // Oct 28 (review): the card path can only ever charge a card — a bank account saved for
          // bank autopay is refused by Stripe here instead of being debited with card rules.
          payment_method_types: ["card"],
          description: `Autopay — Aloha RV Park invoice ${invoice.id}`,
          ...(connectSplit
            ? {
                application_fee_amount: connectSplit.applicationFeeAmountCents,
                transfer_data: { destination: connectSplit.connectedAccountId },
              ...(connectSplit.statementDescriptorSuffix ? { statement_descriptor_suffix: connectSplit.statementDescriptorSuffix } : {}),
              }
            : {}),
        }, {
          // Oct 20 (security review): if this cron is ever invoked twice on
          // the same day (Vercel retry, manual re-run, overlapping runs),
          // Stripe returns the SAME PaymentIntent instead of charging the
          // card a second time. Keyed by invoice + run date + amount, so a
          // declined card is still retried normally on the next day's run,
          // and a changed amount (e.g. a late fee added) is a new charge.
          idempotencyKey: `autopay-${invoice.id}-${todayStr}-${Math.round(chargeAmount * 100)}`,
        });

        if (paymentIntent.status === "succeeded") {
          await supabaseAdmin
            .from("resident_invoices")
            .update({ status: "Paid" })
            .eq("id", invoice.id);
          chargedCount += 1;
          await logRvOnlinePayment({
            companyId: resident.company_id || null, sourceId: paymentIntent.id, description: "Autopay (online)",
            payerName: resident.full_name, amountCents: paymentIntent.amount, reference: paymentIntent.id,
          });

          // Aug 6 (per Mely): same "attach fee/tax as real invoice items,
          // then recompute total_amount" pattern the manual Pay Now
          // webhook uses — autopay charges via a direct PaymentIntent, so
          // it never passes through that webhook and previously left the
          // invoice record showing only the original amount, not what was
          // truly charged.
          if (taxAmount > 0 || (passFeeToResident && processingFee > 0)) {
            if (taxAmount > 0) {
              await supabaseAdmin.from("resident_invoice_items").insert({
                invoice_id: invoice.id,
                charge_type: "Sales Tax",
                description: `Sales Tax (${taxRatePercent}%)`,
                amount: taxAmount,
              });
            }
            if (passFeeToResident && processingFee > 0) {
              await supabaseAdmin.from("resident_invoice_items").insert({
                invoice_id: invoice.id,
                charge_type: "Card Processing Fee",
                description: "Card Processing Fee",
                amount: processingFee,
              });
            }

            const { data: allItems } = await supabaseAdmin
              .from("resident_invoice_items")
              .select("amount")
              .eq("invoice_id", invoice.id);
            const recomputedTotal = (allItems || []).reduce(
              (sum, item) => sum + Number(item.amount || 0),
              0
            );
            await supabaseAdmin
              .from("resident_invoices")
              .update({ total_amount: recomputedTotal })
              .eq("id", invoice.id);
          }

          // Aug 4 (per Mely): so admin can actually SEE and verify the
          // real amount autopay charged each month, instead of just
          // trusting it happened silently — same real-time notification
          // bell used everywhere else.
          await supabaseAdmin.from("resident_update_notifications").insert({
            company_id: resident.company_id,
            resident_id: resident.id,
            resident_name: resident.full_name,
            update_type: "autopay_charged",
            message: `Autopay charged ${resident.full_name} $${chargeAmount.toFixed(2)} for invoice due ${invoice.due_date}.`,
          });
        } else {
          failedCount += 1;
        }
      } catch (err) {
        console.error(`Autopay charge failed for resident ${resident.id}, invoice ${invoice.id}:`, err);
        failedCount += 1;
        // A failed/declined card shouldn't silently keep retrying forever
        // without the resident knowing — turn autopay off so they have to
        // come back and re-enable it (which also lets them update the card).
        await supabaseAdmin
          .from("resident_accounts")
          .update({ autopay_enabled: false })
          .eq("id", resident.id);

        await supabaseAdmin.from("resident_update_notifications").insert({
          company_id: resident.company_id,
          resident_id: resident.id,
          resident_name: resident.full_name,
          update_type: "autopay_failed",
          message: `Autopay FAILED for ${resident.full_name} (invoice due ${invoice.due_date}, $${chargeAmount.toFixed(2)}) — autopay has been turned off for them.`,
        });
      }
    }
  }

  return NextResponse.json({ success: true, chargedCount, failedCount, bank, bankReconcile });
}
