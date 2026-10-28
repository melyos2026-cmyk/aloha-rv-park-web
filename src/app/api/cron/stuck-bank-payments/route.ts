import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { isMissingColumn } from "@/lib/rvBankAutopay";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ISSUE_TYPE = "rv_bank_payment_stuck";
const STUCK_DAYS = 7;

// GET /api/cron/stuck-bank-payments — Oct 28 (per Mely): once a day, find RV resident invoices that
// have been "Processing" (bank payment clearing) for more than 7 calendar days — a normal bank payment
// clears in 3–5 business days — and tell the office in System Health, ONE issue per invoice (an
// invoice that already has one is never logged again, open or resolved).
// Read-only: it never changes an invoice's status. Its only write besides System Health: an invoice
// found "Processing" with no processing_since yet (it started before that column existed) gets
// processing_since = now, so its 7 days are counted from the first time this check saw it.
export async function GET(request: Request) {
  // Fail closed, like process-autopay.
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rows, error } = await supabase
    .from("resident_invoices")
    .select("id, company_id, resident_id, invoice_month, total_amount, processing_since")
    .eq("status", "Processing")
    .limit(2000);
  if (error) {
    if (isMissingColumn(error, "processing_since")) {
      return NextResponse.json({ success: false, error: "resident_invoices.processing_since is missing — run rv_ach_autopay.sql." });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cutoff = Date.now() - STUCK_DAYS * 86400000;
  let started = 0, logged = 0, alreadyLogged = 0;
  for (const inv of rows || []) {
    if (!inv.processing_since) {
      await supabase.from("resident_invoices").update({ processing_since: new Date().toISOString() }).eq("id", inv.id).eq("status", "Processing").is("processing_since", null);
      started++;
      continue;
    }
    if (new Date(inv.processing_since).getTime() > cutoff) continue;
    if (!inv.company_id) continue;

    const { data: existing, error: lookupErr } = await supabase
      .from("system_health_issues")
      .select("id")
      .eq("company_id", inv.company_id)
      .eq("issue_type", ISSUE_TYPE)
      .like("message", `%${inv.id}%`)
      .limit(1);
    if (lookupErr) continue; // can't check for a duplicate → try again tomorrow
    if (existing && existing.length > 0) { alreadyLogged++; continue; }

    const { data: res } = inv.resident_id
      ? await supabase.from("resident_accounts").select("full_name").eq("id", inv.resident_id).maybeSingle()
      : { data: null };
    const name = res?.full_name || "A resident";
    const days = Math.floor((Date.now() - new Date(inv.processing_since).getTime()) / 86400000);
    await logSystemHealthIssue({
      companyId: inv.company_id,
      residentId: inv.resident_id || null,
      issueType: ISSUE_TYPE,
      source: "stuck_bank_payments",
      message: `${name}'s ${inv.invoice_month || ""} invoice ($${Number(inv.total_amount || 0).toFixed(2)}) has been "Processing" (bank payment clearing) for ${days} days — bank payments normally clear in 3–5 business days. Check this resident's payment in Stripe → Payments: if it succeeded or failed there, the invoice should have been updated (check the webhook events payment_intent.succeeded / payment_intent.payment_failed and checkout.session.async_payment_succeeded / _failed); if there is no payment, set the invoice back to Pending. Nothing was changed automatically. Invoice ${inv.id}.`,
    });
    logged++;
  }

  return NextResponse.json({ success: true, processing: (rows || []).length, started, logged, alreadyLogged });
}
