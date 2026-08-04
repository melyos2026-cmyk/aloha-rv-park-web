import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/create-occupant-background-check-checkout-session
// Body: { residentId, occupantIds: string[] }
// Aug 4 (per Mely): lets a resident pay for one or MORE Household
// Occupants' background checks in a single Stripe charge (instead of
// repeating checkout per person) — quantity is simply how many occupant
// IDs are selected on /residents/background-checks. Fee comes from
// park_settings.lease_defaults.application_fee_per_additional, same
// figure used for additional occupants at original application time.
export async function POST(req: Request) {
  try {
    const { residentId, occupantIds } = await req.json();

    if (!residentId || !Array.isArray(occupantIds) || occupantIds.length === 0) {
      return NextResponse.json(
        { error: "residentId and at least one occupantId are required." },
        { status: 400 }
      );
    }

    const authError = requireMatchingSession(req, residentId);
    if (authError) return authError;

    const { data: resident } = await supabase
      .from("resident_accounts")
      .select("id, full_name, email, company_id")
      .eq("id", residentId)
      .maybeSingle();

    if (!resident) {
      return NextResponse.json({ error: "Resident not found." }, { status: 404 });
    }

    // Confirm every occupant actually belongs to this resident and hasn't
    // already been paid for — never trust IDs from the client alone.
    const { data: occupants } = await supabase
      .from("resident_occupants")
      .select("id, full_name, background_check_fee_paid")
      .in("id", occupantIds)
      .eq("resident_id", residentId)
      .eq("occupant_type", "household");

    const validOccupants = (occupants || []).filter((o) => !o.background_check_fee_paid);

    if (validOccupants.length === 0) {
      return NextResponse.json(
        { error: "No eligible occupants found for this charge." },
        { status: 400 }
      );
    }

    const { data: settings } = await supabase
      .from("park_settings")
      .select("lease_defaults")
      .eq("company_id", resident.company_id)
      .maybeSingle();

    const feeAmount = Number(settings?.lease_defaults?.application_fee_per_additional) || 0;

    if (feeAmount <= 0) {
      return NextResponse.json(
        { error: "Background check fee is not configured for this park." },
        { status: 400 }
      );
    }

    const hostHeader = req.headers.get("host") || "aloharvparkfl.com";
    const protocol = hostHeader.includes("localhost") ? "http" : "https";
    const siteUrl = `${protocol}://${hostHeader}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: resident.email || undefined,
      line_items: [
        {
          quantity: validOccupants.length,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(feeAmount * 100),
            product_data: {
              name: "Household Occupant Background Check",
              description: `Background check for ${validOccupants
                .map((o) => o.full_name)
                .join(", ")}`,
            },
          },
        },
      ],
      metadata: {
        type: "occupant_background_check",
        resident_id: residentId,
        occupant_ids: validOccupants.map((o) => o.id).join(","),
      },
      success_url: `${siteUrl}/residents/background-checks?paid=1`,
      cancel_url: `${siteUrl}/residents/background-checks`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Could not create checkout session." },
      { status: 500 }
    );
  }
}
