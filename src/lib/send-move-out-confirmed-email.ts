import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type MoveOutConfirmedData = {
  toEmail: string;
  residentName: string;
  companyName: string;
  moveOutDate: string;
};

function formatDate(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Aug 6 (per Mely: "cómo el residente sabe que fue aprobado?"): admin
// confirming a resident's requested move-out date previously updated
// lease_end silently — nothing ever told the resident it had been
// received/approved. Same Resend setup already used for payment
// reminders/receipts, different template.
export async function sendMoveOutConfirmedEmail(data: MoveOutConfirmedData) {
  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background:#f0fdf4; padding:24px;">
    <div style="background:#ffffff; border:1px solid #16a34a; border-radius:12px; padding:24px;">
      <h1 style="color:#111; font-size:22px; margin:0 0 4px 0;">Move-Out Date Confirmed</h1>
      <p style="color:#333; font-size:14px; margin:0 0 20px 0;">${data.companyName}</p>

      <p style="color:#111; font-size:15px; line-height:1.6;">
        Hi ${data.residentName},<br/><br/>
        The office has confirmed your planned move-out date:
      </p>

      <div style="background:#f9fafb; border-radius:8px; padding:16px; margin:16px 0; text-align:center;">
        <p style="margin:0; color:#111; font-size:20px; font-weight:bold;">${formatDate(data.moveOutDate)}</p>
      </div>

      <p style="color:#333; font-size:14px;">
        If this date changes, please let the office know as soon as possible through your resident portal.
      </p>

      <p style="text-align:center; margin-top:20px;">
        <a href="https://aloharvparkfl.com/residents/dashboard"
           style="background:#16a34a; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
          View Resident Portal
        </a>
      </p>
    </div>
    <p style="text-align:center; color:#9ca3af; font-size:11px; margin-top:16px;">Powered by MelyOS.io</p>
  </div>`;

  await resend.emails.send({
    from: `${data.companyName} <noreply@aloharvparkfl.com>`,
    to: data.toEmail,
    subject: `Your move-out date is confirmed — ${formatDate(data.moveOutDate)}`,
    html,
  });
}
