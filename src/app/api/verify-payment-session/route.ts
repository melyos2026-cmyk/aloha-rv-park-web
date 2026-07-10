import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    const residentId = session.metadata?.resident_id || null;
    const paymentIdsRaw = session.metadata?.payment_ids || "";
    const paymentIds = paymentIdsRaw.split(",").filter(Boolean);

    let remainingBalance = 0;
    if (residentId) {
      const { data: pending, error } = await supabase
        .from("resident_payments")
        .select("total_due, amount")
        .eq("resident_id", residentId)
        .in("status", ["Pending", "Late", "Partial"]);

      if (!error && pending) {
        remainingBalance = pending.reduce(
          (sum, p) => sum + Number(p.total_due || p.amount || 0),
          0
        );
      }
    }

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
    }

    const paymentIntentObj = session.payment_intent as Stripe.PaymentIntent | null;

    let cardBrand = "card";
    let cardLast4 = "----";

    if (paymentIntentObj?.id) {
      const fullPaymentIntent = await stripe.paymentIntents.retrieve(
        paymentIntentObj.id,
        { expand: ["latest_charge"] }
      );
      const charge = fullPaymentIntent.latest_charge as Stripe.Charge | null;
      const details = charge?.payment_method_details;
      const card = details?.card;
      if (card) {
        cardBrand = card.brand || "card";
        cardLast4 = card.last4 || "----";
      } else if (details?.type) {
        cardBrand = details.type;
        cardLast4 = "";
      }
    }

    return NextResponse.json({
      paymentStatus: session.payment_status,
      amountPaid: (session.amount_total || 0) / 100,
      receiptNumber: paymentIntentObj?.id || sessionId,
      transactionId: session.id,
      paymentDate: new Date(session.created * 1000).toISOString(),
      paymentMethodBrand: cardBrand,
      paymentMethodLast4: cardLast4,
      chargesPaid,
      remainingBalance,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not verify payment session." },
      { status: 500 }
    );
  }
}
