import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type ChargeItem = {
  label: string;
  amount: number;
};

type ReceiptData = {
  toEmail: string;
  residentName: string;
  amountPaid: number;
  chargesPaid: ChargeItem[];
  receiptNumber: string;
  transactionId: string;
  paymentDate: Date;
  remainingBalance: number;
};

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

export async function sendReceiptEmail(data: ReceiptData) {
  const chargesHtml = data.chargesPaid
    .map(
      (c) =>
        `<tr>
          <td style="padding:8px 0;color:#111;">${c.label}</td>
          <td style="padding:8px 0;color:#111;text-align:right;">${formatMoney(c.amount)}</td>
        </tr>`
    )
    .join("");

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background:#e1f8f7; padding:24px;">
    <div style="background:#ffffff; border:1px solid #16a34a; border-radius:12px; padding:24px;">
      <h1 style="color:#111; font-size:22px; margin:0 0 4px 0;">Payment Receipt</h1>
      <p style="color:#333; font-size:14px; margin:0 0 20px 0;">Aloha RV Park</p>

      <div style="border-bottom:1px solid #eee; padding-bottom:16px; margin-bottom:16px;">
        <p style="color:#111; font-size:15px; margin:0;">Hi ${data.residentName},</p>
        <p style="color:#333; font-size:14px;">Your payment was processed successfully. Here are your details:</p>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
        ${chargesHtml}
      </table>

      <div style="border-top:1px solid #eee; padding-top:12px; margin-bottom:16px;">
        <table style="width:100%;">
          <tr>
            <td style="color:#111; font-weight:bold;">Total Paid</td>
            <td style="color:#16a34a; font-weight:bold; text-align:right;">${formatMoney(data.amountPaid)}</td>
          </tr>
        </table>
      </div>

      <div style="font-size:13px; color:#555; line-height:1.6;">
        <p style="margin:2px 0;"><strong>Receipt #:</strong> ${data.receiptNumber}</p>
        <p style="margin:2px 0;"><strong>Transaction ID:</strong> ${data.transactionId}</p>
        <p style="margin:2px 0;"><strong>Date:</strong> ${data.paymentDate.toLocaleString()}</p>
        <p style="margin:2px 0;"><strong>Remaining Balance:</strong> ${formatMoney(data.remainingBalance)}</p>
      </div>
    </div>

    <p style="text-align:center; color:#888; font-size:12px; margin-top:16px;">
      Aloha RV Park · 4648 S. Orange Blossom Trl, Kissimmee, FL 34746
    </p>
  </div>
  `;

  try {
    const result = await resend.emails.send({
      from: "Aloha RV Park <onboarding@resend.dev>",
      to: data.toEmail,
      subject: `Payment Receipt - ${formatMoney(data.amountPaid)}`,
      html,
    });
    console.log("Receipt email sent:", result);
    return result;
  } catch (err) {
    console.error("Error sending receipt email:", err);
    throw err;
  }
}
