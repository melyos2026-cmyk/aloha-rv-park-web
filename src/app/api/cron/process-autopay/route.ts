import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export const dynamic = "force-dynamic";

// GET /api/cron/process-autopay
// Runs daily. Charges any Pending resident_invoices for residents who have
// autopay_enabled + a saved card, once the invoice's due date has arrived.
// Uses Stripe's off_session confirmation (the resident isn't present) with
// their saved payment method.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayStr = new Date().toISOString().split("T")[0];

  const { data: autopayResidents, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, company_id, stripe_customer_id, stripe_payment_method_id, full_name, email")
    .eq("autopay_enabled", true)
    .not("stripe_customer_id", "is", null)
    .not("stripe_payment_method_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let chargedCount = 0;
  let failedCount = 0;

  for (const resident of autopayResidents || []) {
    const { data: invoices } = await supabaseAdmin
      .from("resident_invoices")
      .select("id, total_amount, due_date")
      .eq("resident_id", resident.id)
      .eq("status", "Pending")
      .lte("due_date", todayStr);

    for (const invoice of invoices || []) {
      const amount = Number(invoice.total_amount || 0);
      if (amount <= 0) continue;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "usd",
          customer: resident.stripe_customer_id!,
          payment_method: resident.stripe_payment_method_id!,
          off_session: true,
          confirm: true,
          description: `Autopay — Aloha RV Park invoice ${invoice.id}`,
        });

        if (paymentIntent.status === "succeeded") {
          await supabaseAdmin
            .from("resident_invoices")
            .update({ status: "Paid" })
            .eq("id", invoice.id);
          chargedCount += 1;

          // Aug 4 (per Mely): so admin can actually SEE and verify the
          // real amount autopay charged each month, instead of just
          // trusting it happened silently — same real-time notification
          // bell used everywhere else.
          await supabaseAdmin.from("resident_update_notifications").insert({
            company_id: resident.company_id,
            resident_id: resident.id,
            resident_name: resident.full_name,
            update_type: "autopay_charged",
            message: `Autopay charged ${resident.full_name} $${amount.toFixed(2)} for invoice due ${invoice.due_date}.`,
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
          message: `Autopay FAILED for ${resident.full_name} (invoice due ${invoice.due_date}, $${amount.toFixed(2)}) — autopay has been turned off for them.`,
        });
      }
    }
  }

  return NextResponse.json({ success: true, chargedCount, failedCount });
}
