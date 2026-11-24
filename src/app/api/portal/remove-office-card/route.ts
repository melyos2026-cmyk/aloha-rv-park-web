import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// POST /api/portal/remove-office-card — Nov 24 (per Mely): the resident removes the card the office saved
// for them. The card is detached from their account at the processor too (unless it is also their
// autopay card), so the office can't charge it any more. Body: { residentId }
export async function POST(req: NextRequest) {
  const { residentId } = await req.json().catch(() => ({}));
  if (!residentId) return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  const { data: r } = await supabase.from("resident_accounts").select("id, company_id, full_name, office_card_pm_id, office_card_label, stripe_payment_method_id").eq("id", residentId).maybeSingle();
  if (!r?.office_card_pm_id) return NextResponse.json({ ok: true });
  const { error } = await supabase.from("resident_accounts").update({ office_card_pm_id: null, office_card_label: null, office_card_saved_at: null }).eq("id", r.id);
  if (error) return NextResponse.json({ error: "Could not remove the card. Please try again." }, { status: 500 });
  if (r.office_card_pm_id !== r.stripe_payment_method_id) await stripe.paymentMethods.detach(r.office_card_pm_id).catch(() => null);
  await supabase.from("saved_card_consents").update({ revoked_at: new Date().toISOString() }).eq("resident_id", r.id).eq("payment_method_ref", r.office_card_pm_id).is("revoked_at", null).then(() => null, () => null);
  await supabase.from("resident_update_notifications").insert({
    company_id: r.company_id, resident_id: r.id, resident_name: r.full_name || null, update_type: "card_saved",
    message: `${r.full_name || "A resident"} removed the card the office had saved (${r.office_card_label || "saved card"}).`,
  }).then(() => null, () => null);
  return NextResponse.json({ ok: true });
}
