import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const MAX_QTY: Record<string, number> = { "20lb": 20, "30lb": 20, "40lb": 20, forklift: 20, motorhome: 200 };

// POST /api/create-propane-checkout
// Body: { productId, quantity, parkId, customerEmail }
// Same propane_pricing/propane_orders tables as the map's "Buy Propane"
// flow — a purchase made from the website's own /propane page behaves
// identically to one made from the map (same pricing, same QR pickup flow).
export async function POST(req: NextRequest) {
  try {
    const { productId, quantity, parkId, customerEmail, lotNumber } = await req.json();

    if (!customerEmail && !lotNumber) {
      return NextResponse.json(
        { error: "Please provide an email address, or your lot number if you're a resident." },
        { status: 400 }
      );
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("park_id", parkId || "aloha")
      .single();

    if (!company) {
      return NextResponse.json({ error: "Park not found" }, { status: 404 });
    }

    const { data: product } = await supabase
      .from("propane_pricing")
      .select("label, price, unit, taxable, tax_mode")
      .eq("company_id", company.id)
      .eq("product_id", productId)
      .single();

    if (!product) {
      return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
    }

    const { data: taxSettings } = await supabase
      .from("company_tax_settings")
      .select("enable_tax, manual_tax_rate_percent")
      .eq("company_id", company.id)
      .maybeSingle();

    const isGallon = product.unit === "gallon";
    const rawQty = isGallon ? parseFloat(quantity) : parseInt(quantity, 10);
    const maxQty = MAX_QTY[productId] || 20;

    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });
    }
    if (rawQty > maxQty) {
      return NextResponse.json({ error: `Cantidad máxima: ${maxQty}` }, { status: 400 });
    }

    const origin = req.headers.get("origin") || `https://${req.headers.get("host")}`;
    const unitAmount = Math.round(Number(product.price) * 100);
    const lineItemAmount = isGallon ? Math.round(unitAmount * rawQty) : unitAmount;
    const lineItemQty = isGallon ? 1 : rawQty;

    // 4% card processing fee — separate charge, not a tax.
    const subtotalCents = lineItemAmount * lineItemQty;
    const processingFeeCents = Math.round(subtotalCents * 0.04);

    // Sales tax — per-company rate (works for any state, not hardcoded).
    // tax_mode overrides the product's default "taxable" rule when set:
    // "excluded" forces tax to be added on top, "included" means the listed
    // price already has tax baked in (no separate line), blank/null falls
    // back to the taxable checkbox.
    const effectiveTaxApplies =
      product.tax_mode === "excluded"
        ? true
        : product.tax_mode === "included"
        ? false
        : !!product.taxable;
    const taxEnabled = !!taxSettings?.enable_tax && effectiveTaxApplies;
    const taxRatePercent = Number(taxSettings?.manual_tax_rate_percent || 0);
    const taxCents = taxEnabled ? Math.round(subtotalCents * (taxRatePercent / 100)) : 0;

    const lineItems: any[] = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.label,
            description: isGallon ? `${rawQty} gallons × $${product.price}` : `Quantity: ${rawQty}`,
          },
          unit_amount: lineItemAmount,
        },
        quantity: lineItemQty,
      },
    ];

    if (taxCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: `Sales Tax (${taxRatePercent}%)` },
          unit_amount: taxCents,
        },
        quantity: 1,
      });
    }

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Card Processing Fee" },
        unit_amount: processingFeeCents,
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: customerEmail || undefined,
      line_items: lineItems,
      metadata: {
        productId,
        quantity: String(rawQty),
        lotId: "",
        residentLot: lotNumber || "",
        park: parkId || "aloha",
        subtotalCents: String(subtotalCents),
        taxCents: String(taxCents),
        feeCents: String(processingFeeCents),
      },
      success_url: `${origin}/propane?propane_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/propane?propane_payment=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Propane checkout error:", err);
    return NextResponse.json({ error: "No se pudo crear la sesión de pago" }, { status: 500 });
  }
}
