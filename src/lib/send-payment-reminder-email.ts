import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type ReminderData = {
  toEmail: string;
  residentName: string;
  invoiceMonth: string;
  amountDue: number;
  daysLate: number;
  dueDate: string;
};

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

// Aug 5 (per Mely): admin-triggered reminder (single "Send Reminder" button
// per late invoice, or "Send Reminder to All Late" in bulk) — same Resend
// setup already used for payment receipts, just a different template.
export async function sendPaymentReminderEmail(data: ReminderData) {
  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background:#fef2f2; padding:24px;">
    <div style="background:#ffffff; border:1px solid #dc2626; border-radius:12px; padding:24px;">
      <h1 style="color:#111; font-size:22px; margin:0 0 4px 0;">Payment Reminder</h1>
      <p style="color:#333; font-size:14px; margin:0 0 20px 0;">Aloha RV Park</p>

      <p style="color:#111; font-size:15px; line-height:1.6;">
        Hi ${data.residentName},<br/><br/>
        This is a reminder that your invoice for <strong>${data.invoiceMonth}</strong> is now
        <strong>${data.daysLate} day${data.daysLate === 1 ? "" : "s"} past due</strong>
        (due date was ${data.dueDate}).
      </p>

      <div style="background:#f9fafb; border-radius:8px; padding:16px; margin:16px 0;">
        <p style="margin:2px 0; color:#111;"><strong>Amount Due:</strong> ${formatMoney(data.amountDue)}</p>
        <p style="margin:2px 0; color:#111;"><strong>Original Due Date:</strong> ${data.dueDate}</p>
      </div>

      <p style="color:#333; font-size:14px;">
        Please log in to your resident portal to review and pay your balance as soon as possible.
      </p>

      <p style="text-align:center; margin-top:20px;">
        <a href="https://aloharvparkfl.com/residents/dashboard"
           style="background:#dc2626; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
          Pay Now
        </a>
      </p>
    </div>

    <p style="text-align:center; color:#888; font-size:12px; margin-top:16px;">
      Aloha RV Park · 4648 S. Orange Blossom Trl, Kissimmee, FL 34746
    </p>
  </div>
  `;

  try {
    const result = await resend.emails.send({
      from: "Aloha RV Park <noreply@aloharvparkfl.com>",
      to: data.toEmail,
      subject: `Payment Reminder — ${formatMoney(data.amountDue)} past due`,
      html,
    });
    console.log("Payment reminder email sent:", result);
    return result;
  } catch (err) {
    console.error("Error sending payment reminder email:", err);
    throw err;
  }
}
