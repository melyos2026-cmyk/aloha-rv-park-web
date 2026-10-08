import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Oct 8 (per Mely — Checkr production go-live): a failed Checkr
// invitation must never fail silently, or the park loses the sale.
// Always emails MelyOS (owner) with the real reason; also emails the
// park's contact when notifyPark is true (the Stripe-paid path already
// emails the park itself, so it passes false to avoid a duplicate).
export async function alertCheckrFailure(opts: {
  applicationId: string;
  applicantName: string;
  companyId?: string | null;
  failures: { name: string; reason: string }[];
  notifyPark: boolean;
}) {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const ownerEmail = process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com";
    let companyName = "Aloha RV Park";
    const to = new Set<string>([ownerEmail]);
    if (opts.companyId) {
      const { data: company } = await supabase
        .from("companies")
        .select("company_name, contact_email")
        .eq("id", opts.companyId)
        .maybeSingle();
      if (company?.company_name) companyName = company.company_name;
      if (opts.notifyPark && company?.contact_email) to.add(company.contact_email);
    }
    const rows = opts.failures
      .map((f) => `<li><strong>${f.name}</strong>: ${f.reason}</li>`)
      .join("");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `MelyOS Alerts <noreply@aloharvparkfl.com>`,
        to: Array.from(to),
        subject: `ACTION NEEDED — background check did NOT send for ${opts.applicantName} (${companyName})`,
        html: `<p>The background check invitation failed for <strong>${opts.applicantName}</strong> at ${companyName}.</p>
               <ul>${rows}</ul>
               <p><strong>What to do:</strong> open Applications in the admin, find this applicant (flagged red "invitation failed — resend needed") and click resend. The applicant is NOT charged again, and the application is not lost.</p>
               <p style="color:#666;font-size:12px">Application id: ${opts.applicationId}</p>`,
      }),
    });
  } catch (err) {
    console.error("alertCheckrFailure failed:", err);
  }
}
