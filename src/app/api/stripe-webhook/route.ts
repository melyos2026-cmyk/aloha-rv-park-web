import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendReceiptEmail } from "@/lib/send-receipt-email";
import { createCheckrInvitation, computeAggregateStatus, CheckrResultEntry } from "@/lib/checkr";
import { checkAndCompleteRentToOwnPlan } from "@/lib/rentToOwnCompletion";
import { generateApplicationFeeReceiptPdf } from "@/lib/generate-application-fee-receipt";
import crypto from "crypto";

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

    if (session.metadata?.type === "rent_to_own_deposit") {
      await handleRentToOwnDepositPaid(session);
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.productId) {
      await handlePropanePaid(session);
      return NextResponse.json({ received: true });
    }

    const residentId = session.metadata?.resident_id;
    const invoiceIdsRaw = session.metadata?.invoice_ids || "";
    const invoiceIds = invoiceIdsRaw.split(",").filter(Boolean);

    console.log("Payment completed for resident:", residentId);
    console.log("Marking invoice IDs as Paid:", invoiceIds);

    let chargesPaid: { label: string; amount: number }[] = [];

    if (invoiceIds.length > 0) {
      const { data: paidInvoices } = await supabase
        .from("resident_invoices")
        .select("id, total_amount, invoice_month")
        .in("id", invoiceIds);

      chargesPaid = chargesPaid.concat(
        (paidInvoices || []).map((inv) => ({
          label: `Invoice — ${inv.invoice_month}`,
          amount: Number(inv.total_amount || 0),
        }))
      );

      const { error: invoiceUpdateError } = await supabase
        .from("resident_invoices")
        .update({ status: "Paid" })
        .in("id", invoiceIds);

      if (invoiceUpdateError) {
        console.log("Error updating resident_invoices:", invoiceUpdateError.message);
      } else {
        console.log("resident_invoices updated successfully.");
        if (residentId) {
          const { data: residentRow } = await supabase
            .from("resident_accounts")
            .select("company_id")
            .eq("id", residentId)
            .maybeSingle();
          if (residentRow?.company_id) {
            await checkAndCompleteRentToOwnPlan(residentId, residentRow.company_id);
          }
        }
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

  // Defaults to true so any older/other caller of this checkout route
  // (without this metadata) keeps the pre-existing always-run-Checkr behavior.
  const requiresBackgroundCheck =
    session.metadata?.requires_background_check !== "false";
  const stayAmount = Number(session.metadata?.stay_amount) || 0;

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
      background_check_status: requiresBackgroundCheck
        ? "payment_confirmed"
        : "not_required",
    })
    .eq("id", applicationId)
    .select("id, full_name, email, application_fee_total, company_id, occupants")
    .single();

  if (error) {
    console.log("Error updating resident_applications after fee payment:", error.message);
    return;
  }

  console.log(
    `Application fee paid for ${application?.full_name} ($${application?.application_fee_total}).` +
      (requiresBackgroundCheck
        ? " Background check status: payment_confirmed."
        : ` No background check required for this stay (short stay${stayAmount > 0 ? `, $${stayAmount.toFixed(2)} stay charge included` : ""}).`)
  );

  // Each park sets their own notification email under Business Profile
  // (companies.contact_email) — this used to be a single hardcoded env var
  // shared across every company, which doesn't work once there's more than
  // one client on the platform. Falls back to the env var only if the park
  // hasn't set one yet.
  let adminNotifyEmail = process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com";
  if (application?.company_id) {
    const { data: notifyCompany } = await supabase
      .from("companies")
      .select("contact_email")
      .eq("id", application.company_id)
      .maybeSingle();
    if (notifyCompany?.contact_email) {
      adminNotifyEmail = notifyCompany.contact_email;
    }
  }

  // Send the applicant an actual PDF receipt (company name, amount,
  // description, receipt/transaction numbers) — the confirmation page
  // promises "a receipt has been sent to your email", so this needs to be
  // a real receipt, not just the Checkr invitation email's paragraph of
  // instructions.
  if (application?.email && process.env.RESEND_API_KEY) {
    try {
      const { data: company } = await supabase
        .from("companies")
        .select("company_name, address")
        .eq("id", application.company_id)
        .maybeSingle();

      const amountPaid = (session.amount_total || 0) / 100;
      const receiptPdf = await generateApplicationFeeReceiptPdf({
        companyName: company?.company_name || "MelyOS",
        companyAddress: company?.address || null,
        applicantName: application.full_name || "Applicant",
        amountPaid,
        description: stayAmount > 0 ? "Lease Application Fee + Stay Charge" : "Lease Application Fee",
        receiptNumber: paymentIntentId || session.id,
        transactionId: session.id,
        paymentDate: new Date(session.created * 1000),
      });

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${company?.company_name || "MelyOS"} <noreply@aloharvparkfl.com>`,
          to: application.email,
          subject: `Receipt — Application Fee Paid ($${amountPaid.toFixed(2)})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>✅ Payment Confirmed</h2>
              <p>Thank you, ${application.full_name || "Applicant"}. Your application fee payment of
              $${amountPaid.toFixed(2)} was received. Your receipt is attached as a PDF.</p>
            </div>
          `,
          attachments: [
            {
              filename: "application-fee-receipt.pdf",
              content: receiptPdf.toString("base64"),
            },
          ],
        }),
      });
    } catch (receiptErr) {
      console.error("Failed to send application fee receipt PDF:", receiptErr);
    }
  }

  if (!requiresBackgroundCheck) {
    try {
      if (process.env.RESEND_API_KEY) {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "MelyOS <noreply@aloharvparkfl.com>",
            to: adminNotifyEmail,
            subject: `Short-stay application fee${stayAmount > 0 ? " + stay charge" : ""} paid for ${application?.full_name || "applicant"} — no background check needed`,
            html: `<p>${application?.full_name || "An applicant"} just paid their application fee${
              stayAmount > 0 ? ` and $${stayAmount.toFixed(2)} stay charge` : ""
            } for a short stay. No background check was required.</p>`,
          }),
        });
        const emailJson = await emailRes.json();
        if (!emailRes.ok) {
          console.error("Resend admin email failed:", emailJson);
        }
      }
    } catch (emailErr) {
      console.error("Failed to send short-stay admin notification:", emailErr);
    }
    return;
  }

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
          from: "MelyOS <noreply@aloharvparkfl.com>",
          to: adminNotifyEmail,
         subject: checkrInvited
            ? `Background check application sent for ${application?.full_name || "applicant"} (${results.length} ${results.length === 1 ? "person" : "people"})`
            : `Application fee paid — background check FAILED to send for ${application?.full_name || "applicant"}, check manually`,
          html: checkrInvited
            ? `<p>${application?.full_name || "An applicant"} just paid their $${application?.application_fee_total} application fee.</p>
               <p>The background check application has been sent for ${results.length} ${results.length === 1 ? "person" : "people"} on this application. You'll be notified again once results are in.</p>`
            : `<p>${application?.full_name || "An applicant"} just paid their $${application?.application_fee_total} application fee, but the background check failed to send.</p>
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

const PROPANE_PRODUCT_LABELS: Record<string, string> = {
  "20lb": "20 LB Tank",
  "30lb": "30 LB Tank",
  "40lb": "40 LB Tank",
  forklift: "Forklift",
  motorhome: "Motor Home 40LB Tank",
};

// ⚠️ propane_orders holds real Stripe transactions and each row's qr_token
// is the customer's ONLY way to redeem their tank(s) — there is no
// recovery path if a row is deleted. NEVER run an unconditional
// `DELETE FROM propane_orders` (e.g. during a "clear test data" cleanup)
// without a WHERE clause protecting real/recent purchases — this already
// happened once and wiped 2 real customer orders along with test data.
// If bulk-clearing test data, filter by a specific test email/date range,
// or move test rows to `status = 'test'` and filter on that instead.
async function handlePropanePaid(session: Stripe.Checkout.Session) {
  const { productId, quantity, lotId, park, residentLot, subtotalCents, taxCents, feeCents } =
    session.metadata || {};

  try {
    const qrToken = crypto.randomBytes(16).toString("hex");
    const customerEmail = session.customer_details?.email || null;

    const { error } = await supabase.from("propane_orders").upsert(
      {
        park_id: park || "aloha",
        lot_id: lotId || null,
        product_id: productId,
        product_label: PROPANE_PRODUCT_LABELS[productId as string] || productId,
        quantity: parseFloat(quantity as string),
        unit: productId === "motorhome" ? "gallon" : "tank",
        amount_total: (session.amount_total || 0) / 100,
        subtotal_amount: subtotalCents != null ? Number(subtotalCents) / 100 : null,
        tax_amount: taxCents != null ? Number(taxCents) / 100 : null,
        fee_amount: feeCents != null ? Number(feeCents) / 100 : null,
        currency: session.currency || "usd",
        customer_email: customerEmail,
        stripe_session_id: session.id,
        stripe_payment_intent: (session.payment_intent as string) || null,
        status: "paid",
        paid_at: new Date().toISOString(),
        qr_token: qrToken,
        redeemed: false,
        resident_lot_name: residentLot || null,
      },
      { onConflict: "stripe_session_id" }
    );

    if (error) {
      console.error("Error saving propane order:", error.message);
      return;
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("park_id", park || "aloha")
      .single();

    if (company) {
      await supabase.from("resident_update_notifications").insert({
        company_id: company.id,
        resident_name: customerEmail || null,
        update_type: "propane_payment",
        message: `Propane payment received: ${quantity} ${productId === "motorhome" ? "gal" : "×"} ${PROPANE_PRODUCT_LABELS[productId as string] || productId} — $${((session.amount_total || 0) / 100).toFixed(2)}.`,
      });
    }

    if (customerEmail && process.env.RESEND_API_KEY) {
      try {
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrToken)}`;
        const label = PROPANE_PRODUCT_LABELS[productId as string] || productId;
        const amount = ((session.amount_total || 0) / 100).toFixed(2);

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Aloha RV Park <noreply@aloharvparkfl.com>",
            to: customerEmail,
            subject: "Your Propane Pickup QR Code",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 420px; margin: 0 auto;">
                <h2>⛽ Payment Confirmed</h2>
                <p>${quantity} ${productId === "motorhome" ? "gallons" : "×"} ${label} — $${amount}</p>
                <img src="${qrImageUrl}" alt="Propane pickup QR code" style="display:block;margin:16px 0;" />
                <p style="font-size:13px;color:#555;">${
                  productId === "motorhome"
                    ? "Show this code to staff for your fill-up. It can only be used once."
                    : `Show this code to staff each time you pick up a tank — this code works once per tank purchased (${quantity} total, multiple visits OK).`
                } No refunds — unpicked-up tanks are not refundable.</p>
              </div>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("Failed to send propane QR email:", emailErr);
      }
    }
  } catch (err) {
    console.error("Error saving propane order:", err);
  }
}

async function handleRentToOwnDepositPaid(session: Stripe.Checkout.Session) {
  const applicationId = session.metadata?.application_id;
  if (!applicationId) {
    console.log("Rent-to-own deposit webhook missing application_id metadata");
    return;
  }

  const { error } = await supabase
    .from("resident_applications")
    .update({
      rent_to_own_deposit_paid: true,
      rent_to_own_deposit_method: "Stripe",
    })
    .eq("id", applicationId);

  if (error) {
    console.log("Error marking rent-to-own deposit paid:", error.message);
  } else {
    console.log(`Rent-to-own deposit payment confirmed for application ${applicationId}.`);
  }
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

  const { data: updatedOrder, error } = await supabase
    .from("lot_orders")
    .update({
      status: "paid",
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntentId,
    })
    .eq("id", lotOrderId)
    .select("customer_name, lot_id, arrival_date, departure_date")
    .single();

  if (error) {
    console.log("Error updating lot_orders after manual reservation payment:", error.message);
    return;
  }

  console.log(`Manual reservation payment confirmed for lot_order ${lotOrderId}.`);

  // Notify the admin — they created this reservation as "pending" and have
  // no other way of knowing exactly when the guest actually completes payment.
  if (updatedOrder?.lot_id) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("company_id")
      .eq("lot_name", updatedOrder.lot_id)
      .single();

    if (lot?.company_id) {
      await supabase.from("resident_update_notifications").insert({
        company_id: lot.company_id,
        resident_name: updatedOrder.customer_name,
        update_type: "reservation_paid",
        message: `${updatedOrder.customer_name}'s reservation payment for lot ${updatedOrder.lot_id} was confirmed.`,
      });

      // Safety net against a race condition: availability is only checked
      // once, when this checkout session was first created — if another
      // booking for overlapping dates on the same lot completed payment in
      // the meantime, both would now show as "paid". Re-check here and
      // flag it instead of letting a double-booking go unnoticed.
      if (updatedOrder.arrival_date && updatedOrder.departure_date) {
        const { data: otherOrders } = await supabase
          .from("lot_orders")
          .select("id, arrival_date, departure_date")
          .eq("lot_id", updatedOrder.lot_id)
          .eq("status", "paid")
          .neq("id", lotOrderId);

        const newArrival = new Date(updatedOrder.arrival_date + "T00:00:00");
        const newDeparture = new Date(updatedOrder.departure_date + "T00:00:00");
        const conflicting = (otherOrders || []).filter((o: any) => {
          if (!o.arrival_date || !o.departure_date) return false;
          const oStart = new Date(o.arrival_date + "T00:00:00");
          const oEnd = new Date(o.departure_date + "T00:00:00");
          return newArrival < oEnd && newDeparture > oStart;
        });

        if (conflicting.length > 0) {
          console.error(
            `DOUBLE-BOOKING DETECTED on lot ${updatedOrder.lot_id}: lot_order ${lotOrderId} overlaps with`,
            conflicting.map((o: any) => o.id)
          );
          await supabase.from("lot_orders").update({ has_conflict: true }).eq("id", lotOrderId);
          await supabase
            .from("lot_orders")
            .update({ has_conflict: true })
            .in("id", conflicting.map((o: any) => o.id));
          await supabase.from("resident_update_notifications").insert({
            company_id: lot.company_id,
            resident_name: null,
            update_type: "double_booking_alert",
            message: `⚠️ Possible double-booking on Lot ${updatedOrder.lot_id}: two paid reservations overlap for ${updatedOrder.arrival_date} to ${updatedOrder.departure_date}. Review and contact both customers.`,
          });
        }
      }
    }
  }
}
