import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type MoveOutFinalizedData = {
  toEmail: string;
  residentName: string;
  companyName: string;
  moveOutDate: string;
  goodStanding: boolean;
  owingAmount: number;
  pdfBuffer?: Buffer;
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Aug 6 (per Mely): separate from the earlier "your date is confirmed"
// email — this one goes out when admin FINALIZES the move-out (closes
// the lease for good), with the official Move-Out/Cancellation Statement
// attached showing the final account status.
export async function sendMoveOutFinalizedEmail(data: MoveOutFinalizedData) {
  const statusColor = data.goodStanding ? "#16a34a" : "#dc2626";
  const statusText = data.goodStanding
    ? "Your account is in good standing — no balance owed."
    : `You have an outstanding balance of $${data.owingAmount.toFixed(2)}.`;

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background:#f9fafb; padding:24px;">
    <div style="background:#ffffff; border:1px solid ${statusColor}; border-radius:12px; padding:24px;">
      <h1 style="color:#111; font-size:22px; margin:0 0 4px 0;">Move-Out Finalized</h1>
      <p style="color:#333; font-size:14px; margin:0 0 20px 0;">${data.companyName}</p>

      <p style="color:#111; font-size:15px; line-height:1.6;">
        Hi ${data.residentName},<br/><br/>
        Your move-out as of <strong>${formatDate(data.moveOutDate)}</strong> has been finalized. Your official
        Move-Out / Cancellation Statement is attached as a PDF.
      </p>

      <div style="background:#f9fafb; border-radius:8px; padding:16px; margin:16px 0;">
        <p style="margin:0; color:${statusColor}; font-weight:bold; font-size:15px;">${statusText}</p>
        ${
          !data.goodStanding
            ? `<p style="margin:8px 0 0 0; color:#7f1d1d; font-size:13px;">If this balance remains unpaid, it may be sent to a collections agency.</p>`
            : ""
        }
      </div>

      <p style="color:#333; font-size:14px;">
        Thank you for staying with us. If you have any questions about your final statement, please contact the office.
      </p>
    </div>
    <p style="text-align:center; color:#9ca3af; font-size:11px; margin-top:16px;">Powered by MelyOS.io</p>
  </div>`;

  const result = await resend.emails.send({
    from: `${data.companyName} <noreply@aloharvparkfl.com>`,
    to: data.toEmail,
    subject: `Your move-out has been finalized`,
    html,
    attachments: data.pdfBuffer
      ? [{ filename: "move-out-statement.pdf", content: data.pdfBuffer.toString("base64") }]
      : undefined,
  });

  console.log("Move-out finalized email result:", result);

  if (result.error) {
    throw new Error(result.error.message || "Resend returned an error.");
  }

  return result;
}
