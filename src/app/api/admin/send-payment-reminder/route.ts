import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendPaymentReminderEmail } from "@/lib/send-payment-reminder-email";

// POST body: { invoiceId }
// Aug 5 (per Mely): called from melyos-builder's Resident Invoices screen,
// both for the single "Send Reminder" button and for "Send Reminder to
// All Late" (which just calls this once per late invoice).
export async function POST(req: NextRequest) {
  const { invoiceId } = await req.json();

  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required." }, { status: 400 });
  }

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from("resident_invoices")
    .select("id, resident_id, invoice_month, total_amount, due_date")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const { data: resident, error: residentError } = await supabaseAdmin
    .from("resident_accounts")
    .select("full_name, email")
    .eq("id", invoice.resident_id)
    .maybeSingle();

  if (residentError || !resident?.email) {
    return NextResponse.json({ error: "Resident email not found." }, { status: 404 });
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
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("send-payment-reminder error:", err);
    return NextResponse.json(
      { error: "Could not send reminder. Please try again or contact support." },
      { status: 500 }
    );
  }
}
