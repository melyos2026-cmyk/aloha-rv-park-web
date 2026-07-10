import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendReceiptEmail } from "@/lib/send-receipt-email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.log("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // ── NEW: Application Fee & Background Check payment ──────────────
    if (session.metadata?.type === "application_fee") {
      await handleApplicationFeePaid(session);
      return NextResponse.json({ received: true });
    }

    // ── Existing: Resident rent/balance payment (unchanged) ──────────
    const residentId = session.metadata?.resident_id;
    const paymentIdsRaw = session.metadata?.payment_ids || "";
    const paymentIds = paymentIdsRaw.split(",").filter(Boolean);

    console.log("Payment completed for resident:", residentId);
    console.log("Marking payment IDs as Paid:", paymentIds);

    let chargesPaid: { label: string; amount: number }[] = [];

    if (paymentIds.length > 0) {
      const { data: paidCharges } = await supabase
        .from("resident_payments")
        .select("*")
        .in("id", paymentIds);

      chargesPaid = (paidCharges || []).map((p) => ({
        label:
          p.charge_type === "Custom" && p.custom_charge_name
            ? p.custom_charge_name
            : p.charge_type || "Charge",
        amount: Number(p.total_due || p.amount || 0),
      }));

      const { error } = await supabase
        .from("resident_payments")
        .update({
          status: "Paid",
          payment_date: new Date().toISOString(),
          payment_method: "Stripe",
        })
        .in("id", paymentIds);

      if (error) {
        console.log("Error updating resident_payments:", error.message);
      } else {
        console.log("resident_payments updated successfully.");
      }
    }

    // Enviar receipt por email
    if (residentId) {
      try {
        const { data: resident } = await supabase
          .from("resident_accounts")
          .select("full_name, email")
          .eq("id", residentId)
          .single();

        const { data: pending } = await supabase
          .from("resident_payments")
          .select("total_due, amount")
          .eq("resident_id", residentId)
          .in("status", ["Pending", "Late", "Partial"]);

        const remainingBalance = (pending || []).reduce(
          (sum, p) => sum + Number(p.total_due || p.amount || 0),
          0
        );

        if (resident?.email) {
          await sendReceiptEmail({
            toEmail: resident.email,
            residentName: resident.full_name || "Resident",
            amountPaid: (session.amount_total || 0) / 100,
            chargesPaid,
            receiptNumber:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.id,
            transactionId: session.id,
            paymentDate: new Date(session.created * 1000),
            remainingBalance,
          });
        } else {
          console.log("No email found for resident, skipping receipt.");
        }
      } catch (emailErr) {
        console.error("Failed to send receipt email:", emailErr);
      }
    }
  }

  return NextResponse.json({ received: true });
}

/**
 * Handles a paid Application Fee & Background Check checkout session.
 * Marks the application as paid, then notifies the admin that a background
 * check needs to be run. While Checkr isn't connected yet, this is a manual
 * step (admin orders it themselves on Checkr's dashboard) - once Checkr API
 * access is granted, this function is where the automatic Checkr invitation
 * call gets added.
 */
async function handleApplicationFeePaid(session: Stripe.Checkout.Session) {
  const applicationId = session.metadata?.application_id;
  if (!applicationId) {
    console.log("Application fee webhook missing application_id metadata");
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: application, error } = await supabase
    .from("resident_applications")
    .update({
      application_fee_paid: true,
      application_fee_paid_at: new Date().toISOString(),
      application_fee_stripe_payment_intent_id: paymentIntentId,
      background_check_status: "payment_confirmed", // TODO: switch to Checkr-triggered status once API is connected
    })
    .eq("id", applicationId)
    .select("full_name, email, application_fee_total, company_id")
    .single();

  if (error) {
    console.log("Error updating resident_applications after fee payment:", error.message);
    return;
  }

  console.log(
    `Application fee paid for ${application?.full_name} ($${application?.application_fee_total}). Background check status: payment_confirmed.`
  );

  // Notify admin that a background check is ready to be manually ordered
  // (remove/replace this once Checkr API triggers it automatically).
  try {
    if (process.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "ARIA Agent <notifications@melyos.io>",
          to: process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com",
          subject: `Application fee paid — background check needed for ${application?.full_name || "applicant"}`,
          html: `<p>${application?.full_name || "An applicant"} just paid their $${application?.application_fee_total} application fee.</p>
                 <p>Please order their background check manually on Checkr's dashboard until the automated integration is connected.</p>`,
        }),
      });
    }
  } catch (emailErr) {
    console.error("Failed to send background check admin notification:", emailErr);
  }
}
