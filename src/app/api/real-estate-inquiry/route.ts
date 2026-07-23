import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const {
      companyId,
      listingId,
      listingTitle,
      fullName,
      email,
      phone,
      preferredDate,
      preferredTime,
      message,
    } = await req.json();

    if (!companyId || !fullName || !email) {
      return NextResponse.json(
        { error: "companyId, fullName, and email are required." },
        { status: 400 }
      );
    }

    const { error: insertError } = await supabaseAdmin.from("real_estate_inquiries").insert({
      company_id: companyId,
      listing_id: listingId || null,
      listing_title: listingTitle || null,
      full_name: fullName,
      email,
      phone: phone || null,
      preferred_date: preferredDate || null,
      preferred_time: preferredTime || null,
      message: message || null,
    });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Notify the company's own contact email (falls back to Mely's if unset).
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("contact_email")
      .eq("id", companyId)
      .single();

    const notifyEmail = company?.contact_email || process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com";

    if (process.env.RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "MelyOS <onboarding@resend.dev>",
            to: notifyEmail,
            subject: `New appointment request${listingTitle ? `: ${listingTitle}` : ""} from ${fullName}`,
            html: `
              <p>${fullName} requested an appointment${listingTitle ? ` about "${listingTitle}"` : ""}.</p>
              <ul>
                <li>Email: ${email}</li>
                <li>Phone: ${phone || "not provided"}</li>
                <li>Preferred date/time: ${preferredDate || "not specified"} ${preferredTime || ""}</li>
                ${message ? `<li>Message: ${message}</li>` : ""}
              </ul>
            `,
          }),
        });
        if (!emailRes.ok) {
          const emailJson = await emailRes.json();
          console.error("Resend inquiry notification failed:", emailJson);
        }
      } catch (emailErr) {
        console.error("Failed to send inquiry notification email:", emailErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error in real-estate-inquiry route:", err);
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
