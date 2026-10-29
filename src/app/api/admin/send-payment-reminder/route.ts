import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReminderEmail } from "@/lib/send-payment-reminder-email";
import {
  adminCorsHeaders,
  adminSessionSecretConfigured,
  rejectForeignOrigin,
  requireAdminSessionForCompany,
} from "@/lib/adminNotifyAuth";

// Aug 5 (per Mely — real bug she caught: clicking "Remind" in
// melyos-builder failed with "Could not send reminder (unexpected
// error)"): this route is called cross-domain from admin.aloharvparkfl.com,
// and without CORS headers the browser silently blocks the response
// before the frontend ever sees success/failure — it just looks like a
// generic network error. Every response (including the browser's OPTIONS
// preflight) needs Access-Control-Allow-Origin.
// Oct 20 (security review): CORS was "*" with no auth — any website could
// make the park send payment-reminder emails to any resident. CORS is now
// limited to the two admin origins (admin.melyos.io, admin.aloharvparkfl.com)
// and, once ADMIN_SESSION_SECRET is set on this site, a valid admin
// session (x-admin-session header) for the invoice's company is required.
// Until then: only an existing, NOT-yet-paid invoice can be reminded about.
export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: adminCorsHeaders(req) });
}

// POST body: { invoiceId }
// Aug 5 (per Mely): called from melyos-builder's Resident Invoices screen,
// both for the single "Send Reminder" button and for "Send Reminder to
// All Late" (which just calls this once per late invoice).
export async function POST(req: NextRequest) {
  const CORS_HEADERS = adminCorsHeaders(req);
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  const { invoiceId } = await req.json();

  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required." }, { status: 400, headers: CORS_HEADERS });
  }

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from("resident_invoices")
    .select("id, resident_id, invoice_month, total_amount, due_date, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404, headers: CORS_HEADERS });
  }

  // Oct 20 (security review): never "remind" about an invoice that's paid.
  if (invoice.status === "Paid") {
    return NextResponse.json({ error: "This invoice is already paid." }, { status: 409, headers: CORS_HEADERS });
  }
  // Oct 28: a bank (ACH) payment is clearing — not owed, so no reminder.
  if (invoice.status === "Processing") {
    return NextResponse.json({ error: "A bank payment for this invoice is still clearing." }, { status: 409, headers: CORS_HEADERS });
  }

  const { data: resident, error: residentError } = await supabaseAdmin
    .from("resident_accounts")
    .select("full_name, email, company_id")
    .eq("id", invoice.resident_id)
    .maybeSingle();

  if (residentError || !resident?.email) {
    return NextResponse.json({ error: "Resident email not found." }, { status: 404, headers: CORS_HEADERS });
  }

  // Oct 20 (security review): see comment at the top.
  // Oct 26 (security review): fail closed — without ADMIN_SESSION_SECRET no admin session can be
  // checked, so the request is refused instead of skipping the check.
  if (!adminSessionSecretConfigured()) {
    return NextResponse.json({ error: "Admin sign-in is not configured on this site." }, { status: 503, headers: CORS_HEADERS });
  }
  {
    const denied = await requireAdminSessionForCompany(req, resident.company_id);
    if (denied) return denied;
  }

  // Oct 21 (per Mely — security hardening): at most one reminder per invoice per hour,
  // so a resident is never flooded (double clicks, "Remind all late" run twice).
  // Skipped quietly if the column doesn't exist yet.
  const { data: last } = await supabaseAdmin.from("resident_invoices").select("last_reminder_sent_at").eq("id", invoice.id).maybeSingle();
  const lastAt = (last as any)?.last_reminder_sent_at ? new Date((last as any).last_reminder_sent_at).getTime() : 0;
  if (lastAt && Date.now() - lastAt < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.round((Date.now() - lastAt) / 60000));
    return NextResponse.json({ error: `A reminder for this invoice was already sent ${mins} minute${mins === 1 ? "" : "s"} ago. You can send another one in an hour.` }, { status: 429, headers: CORS_HEADERS });
  }

  const dueDateStr = String(invoice.due_date).split("T")[0];
  const daysLate = Math.max(
    0,
    Math.round((Date.now() - new Date(dueDateStr + "T00:00:00").getTime()) / 86400000)
  );

  try {
    await sendPaymentReminderEmail({
      toEmail: resident.email,
      residentName: resident.full_name,
      invoiceMonth: invoice.invoice_month,
      amountDue: Number(invoice.total_amount || 0),
      daysLate,
      dueDate: dueDateStr,
    });
    await supabaseAdmin.from("resident_invoices").update({ last_reminder_sent_at: new Date().toISOString() }).eq("id", invoice.id).then(() => {}, () => {});
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error("send-payment-reminder error:", err);
    return NextResponse.json(
      { error: "Could not send reminder. Please try again or contact support." },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

