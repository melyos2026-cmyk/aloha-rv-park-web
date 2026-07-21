import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { createCheckrInvitation, computeAggregateStatus, CheckrResultEntry } from "@/lib/checkr";

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

    if (session.metadata?.type === "application_fee") {
      await handleApplicationFeePaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.type === "manual_reservation") {
      await handleManualReservationPaid(session);
      return NextResponse.json({ received: true });
    }

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
      background_check_status: "payment_confirmed",
    })
    .eq("id", applicationId)
    .select("id, full_name, email, application_fee_total, company_id, occupants")
    .single();

  if (error) {
    console.log("Error updating resident_applications after fee payment:", error.message);
    return;
  }

  console.log(
    `Application fee paid for ${application?.full_name} ($${application?.application_fee_total}). Background check status: payment_confirmed.`
  );

  const people: { personKey: string; name: string; email: string }[] = [];

  if (application?.email) {
    people.push({
      personKey: "primary",
      name: application.full_name || "Applicant",
      email: application.email,
    });
  }

  const occupants = (application?.occupants || []) as Array<{
    name?: string;
    date_of_birth?: string;
    email?: string;
  }>;
  occupants.forEach((occ, i) => {
    if (!occ?.name || !occ?.date_of_birth) return;
    const age = calculateAge(occ.date_of_birth);
    if (age === null || age < 18) return;
    people.push({
      personKey: `occupant:${i}`,
      name: occ.name,
      email: occ.email || application!.email,
    });
  });

  const results: CheckrResultEntry[] = [];
  for (const person of people) {
    try {
      const { candidateId } = await createCheckrInvitation({
        applicationId: application.id,
        personKey: person.personKey,
        email: person.email,
        fullName: person.name,
      });
      results.push({
        personKey: person.personKey,
        name: person.name,
        candidateId,
        status: "invitation_sent",
      });
    } catch (checkrErr: any) {
      console.error(`Checkr invitation failed for ${person.name}:`, checkrErr.message);
      results.push({ personKey: person.personKey, name: person.name, status: "invitation_failed" });
    }
  }

  const aggregateStatus = computeAggregateStatus(results);
  await supabase
    .from("resident_applications")
    .update({ checkr_results: results, background_check_status: aggregateStatus })
    .eq("id", application.id);

  const checkrInvited = results.length > 0 && results.every((r) => r.status !== "invitation_failed");

  try {
    if (process.env.RESEND_API_KEY) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "MelyOS <onboarding@resend.dev>",
          to: process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com",
          subject: checkrInvited
            ? `Application fee paid — Checkr invitations sent for ${application?.full_name || "applicant"} (${results.length} ${results.length === 1 ? "person" : "people"})`
            : `Application fee paid — some Checkr invitations FAILED for ${application?.full_name || "applicant"}, check manually`,
          html: checkrInvited
            ? `<p>${application?.full_name || "An applicant"} just paid their $${application?.application_fee_total} application fee.</p>
               <p>Checkr invitations were automatically sent for ${results.length} ${results.length === 1 ? "person" : "people"} on this application. You'll be notified again once results are in.</p>`
            : `<p>${application?.full_name || "An applicant"} just paid their $${application?.application_fee_total} application fee, but one or more Checkr invitations failed to send.</p>
               <p>Check the Applications tab for details on who still needs to be invited manually.</p>`,
        }),
      });
      const emailJson = await emailRes.json();
      if (!emailRes.ok) {
        console.error("Resend admin email failed:", emailJson);
      } else {
        console.log("Admin notification email sent:", emailJson.id);
      }
    } else {
      console.log("RESEND_API_KEY not set — skipping admin notification email.");
    }
  } catch (emailErr) {
    console.error("Failed to send background check admin notification:", emailErr);
  }
}

function calculateAge(dateOfBirth: string): number | null {
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

async function handleManualReservationPaid(session: Stripe.Checkout.Session) {
  const lotOrderId = session.metadata?.lot_order_id;
  if (!lotOrderId) {
    console.log("Manual reservation webhook missing lot_order_id metadata");
    return;
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { error } = await supabase
    .from("lot_orders")
    .update({
      status: "paid",
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
    })
    .eq("id", lotOrderId);

  if (error) {
    console.log("Error updating lot_orders after manual reservation payment:", error.message);
    return;
  }

  console.log(`Manual reservation payment confirmed for lot_order ${lotOrderId}.`);
}
