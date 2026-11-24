import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { chargeRvCardAutopayInvoice } from "@/lib/rvCardAutopay";
import { officeSigOk } from "@/lib/officeSavedCard";
import { isInvoicePayableNow } from "@/lib/invoicePayable";

// POST /api/office/charge-saved-card — Nov 24 (per Mely): the park office charges a resident's saved
// card for ONE real invoice of that resident. Called only by the MelyOS admin (signed request; the admin
// already checked the staff member is allowed and the amount was confirmed). The money math, the claim
// (Pending → Processing, never twice), the receipt and the office notice are the card-autopay ones.
// Body: { invoiceId, card: "office", amount, by, ts, sig } — only the card the office saved with the
// resident's OK (saved_card_consents); the portal autopay card is never charged from here.
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const { invoiceId, card, amount, by, ts, sig } = b || {};
  if (!invoiceId || card !== "office" || !by || !ts) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000 || !officeSigOk(sig, ["charge_saved_card", invoiceId, card, amount, by, ts])) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  const { data: invoice } = await supabase.from("resident_invoices").select("id, resident_id, company_id, status, total_amount, due_date, invoice_month, collection_placement_id").eq("id", invoiceId).maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  if (invoice.status !== "Pending" && invoice.status !== "Late") return NextResponse.json({ error: invoice.status === "Paid" ? "This invoice is already paid." : `This invoice is ${invoice.status} — it can't be charged now.` }, { status: 400 });
  if ((invoice as any).collection_placement_id) return NextResponse.json({ error: "This balance is with a collections agency." }, { status: 400 });
  if (!isInvoicePayableNow(invoice.invoice_month)) return NextResponse.json({ error: "This invoice can't be paid yet." }, { status: 400 });
  // the amount the staff confirmed must still be the invoice total (nothing changed in between)
  if (Math.abs(Number(invoice.total_amount || 0) - Number(amount)) > 0.009) return NextResponse.json({ error: "The invoice changed — open it again and confirm the new amount." }, { status: 409 });

  const { data: resident } = await supabase.from("resident_accounts").select("id, company_id, full_name, email, stripe_customer_id, stripe_payment_method_id, office_card_pm_id").eq("id", invoice.resident_id).maybeSingle();
  if (!resident || resident.company_id !== invoice.company_id) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const pmId = resident.office_card_pm_id;
  if (!pmId) return NextResponse.json({ error: "No saved card on this account." }, { status: 400 });

  // the autopay path only takes Pending; a Late invoice is charged the same way
  if (invoice.status === "Late") await supabase.from("resident_invoices").update({ status: "Pending" }).eq("id", invoice.id).eq("status", "Late");
  const today = new Date().toISOString().slice(0, 10);
  const r = await chargeRvCardAutopayInvoice(resident as any, invoice as any, today, { pmId, by: String(by).slice(0, 80) });
  if (invoice.status === "Late" && r.status !== "charged" && r.status !== "unknown") await supabase.from("resident_invoices").update({ status: "Late" }).eq("id", invoice.id).eq("status", "Pending");
  if (r.status === "charged") return NextResponse.json({ ok: true, amount: r.amount });
  if (r.status === "unknown") return NextResponse.json({ ok: false, pending: true, error: "The card processor hasn't answered yet. The invoice is on hold so it isn't charged twice — check again in a few minutes." }, { status: 202 });
  const why = r.detail === "demo" ? "Demo park — no real charges are made." : r.detail === "invoice_no_longer_pending" ? "This invoice is no longer open." : r.detail || "The card was not charged.";
  return NextResponse.json({ error: r.status === "failed" ? `Declined: ${why}` : why }, { status: 400 });
}
