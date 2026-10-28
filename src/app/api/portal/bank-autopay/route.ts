import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { demoPaymentBlock } from "@/lib/demoPayments";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { bankAutopayAuthorizationText } from "@/lib/autopayTerms";
import { ACH_RETURN_FEE } from "@/lib/platformFee";
import { RV_AUTOPAY_SETUP_TYPE, isMissingColumn } from "@/lib/rvBankAutopay";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/portal/bank-autopay — Oct 28 (per Mely): RV resident autopay BY BANK (ACH).
// { residentId, action: "start", authorizationAccepted: true } → { url } — Stripe's secure page
//   (Checkout "setup" mode: the resident links the bank through Financial Connections, instant
//   verification, and accepts the ACH mandate). Same Stripe pattern as marina autopay.
// { residentId, action: "confirm", sessionId } → back from Stripe: save the bank account, autopay on.
// Only when the park offers autopay AND has bank payments explicitly ON (ach_enabled === true).
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;

async function bankAutopayAllowed(companyId: string | null | undefined) {
  if (!companyId) return false;
  const { data } = await supabase.from("company_fee_settings").select("ach_enabled, autopay_available").eq("company_id", companyId).maybeSingle();
  return data?.ach_enabled === true && !!data?.autopay_available;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const residentId = typeof body?.residentId === "string" ? body.residentId : null;
  if (!residentId) return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  // SECURITY: only the signed-in resident, for their own account.
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  if (await tooManyFromIp(req, `rv-bank-autopay:${residentId}`, 15)) {
    return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("id, full_name, email, company_id, stripe_customer_id, companies(company_name)")
    .eq("id", residentId)
    .maybeSingle();
  if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const parkName = (resident as any).companies?.company_name || "";

  if (!(await bankAutopayAllowed(resident.company_id))) {
    return NextResponse.json({ error: "Autopay by bank is not available at this park. You can use a card." }, { status: 400 });
  }

  if (body.action === "start") {
    if (body.authorizationAccepted !== true) {
      return NextResponse.json({ error: "Please check the box to authorize the automatic bank payments." }, { status: 400 });
    }
    { const demoBlocked = await demoPaymentBlock(resident.company_id); if (demoBlocked) return demoBlocked; }
    {
      const { error: colErr } = await supabase.from("resident_accounts").select("autopay_method").eq("id", residentId).maybeSingle();
      if (colErr && isMissingColumn(colErr, "autopay_method")) {
        return NextResponse.json({ error: "Bank autopay isn't available yet. Please use a card for autopay, or pay by bank each month." }, { status: 503 });
      }
    }
    let customerId = resident.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: resident.full_name || undefined,
        email: resident.email || undefined,
        metadata: { resident_id: resident.id },
      });
      customerId = customer.id;
      await supabase.from("resident_accounts").update({ stripe_customer_id: customerId }).eq("id", residentId);
    }
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      currency: "usd",
      payment_method_types: ["us_bank_account"],
      payment_method_options: {
        us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "instant" },
      },
      metadata: { type: RV_AUTOPAY_SETUP_TYPE, resident_id: residentId, company_id: resident.company_id || "", method: "ach" },
      success_url: `${siteUrl}/residents/dashboard?bank_autopay=done&s={CHECKOUT_SESSION_ID}#autopay`,
      cancel_url: `${siteUrl}/residents/dashboard?bank_autopay=cancelled#autopay`,
    }).catch((e: any) => ({ error: e?.message as string }));
    if ("error" in session) return NextResponse.json({ error: session.error || "Could not open the secure page." }, { status: 500 });
    return session.url ? NextResponse.json({ url: session.url }) : NextResponse.json({ error: "Could not open the secure page. Please try again." }, { status: 500 });
  }

  if (body.action === "confirm") {
    const sessionId = String(body.sessionId || "");
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return NextResponse.json({ error: "Session not found." }, { status: 400 });
    const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] }).catch(() => null);
    if (!s || s.mode !== "setup" || s.metadata?.type !== RV_AUTOPAY_SETUP_TYPE || s.metadata.resident_id !== residentId) {
      return NextResponse.json({ error: "Session not found." }, { status: 400 });
    }
    if (Date.now() - s.created * 1000 > 24 * 3600000) return NextResponse.json({ error: "This link is old. Please set up bank autopay again." }, { status: 400 });
    const si = s.setup_intent as Stripe.SetupIntent | null;
    const pm = si?.payment_method as Stripe.PaymentMethod | null;
    if (si?.status === "processing" || si?.status === "requires_action") {
      return NextResponse.json({ error: "Your bank is still verifying the account. Please try again later, or use a card." }, { status: 400 });
    }
    if (!si || !pm || si.status !== "succeeded" || pm.type !== "us_bank_account") {
      return NextResponse.json({ error: "The bank account was not saved. Please try again." }, { status: 400 });
    }
    const siCustomer = typeof si.customer === "string" ? si.customer : si.customer?.id;
    if (!siCustomer || siCustomer !== resident.stripe_customer_id) return NextResponse.json({ error: "Session not found." }, { status: 400 });

    const last4 = pm.us_bank_account?.last4 || null;
    const bankName = pm.us_bank_account?.bank_name || "Bank";
    const authorizationText = bankAutopayAuthorizationText(parkName, ACH_RETURN_FEE);
    const base = {
      stripe_payment_method_id: pm.id,
      autopay_enabled: true,
      autopay_card_last4: last4, // last 4 of the saved method (bank account here)
      autopay_authorized_at: new Date().toISOString(),
      autopay_authorization_text: authorizationText,
      autopay_authorization_ip: ipOf(req),
    };
    // Oct 28 (review): a bank account is NEVER saved without autopay_method = "ach" — if that column
    // isn't there yet (rv_ach_autopay.sql), refuse instead of saving it like a card.
    const { error } = await supabase.from("resident_accounts").update({ ...base, autopay_method: "ach" }).eq("id", residentId);
    if (error && isMissingColumn(error, "autopay_method")) {
      return NextResponse.json({ error: "Bank autopay isn't available yet. Please use a card for autopay, or pay by bank each month." }, { status: 503 });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: residentId,
      resident_name: resident.full_name,
      update_type: "autopay_enabled",
      message: `${resident.full_name} turned on autopay by bank (${bankName} •••• ${last4 || "—"}) and accepted the ACH debit authorization.`,
    }).then(() => null, () => null);
    return NextResponse.json({ success: true, last4, bankName });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
