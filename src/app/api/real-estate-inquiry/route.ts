import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const {
      listingId,
      listingTitle,
      fullName,
      email,
      phone,
      preferredDate,
      preferredTime,
      message,
    } = await req.json();

    if (!fullName || !email) {
      return NextResponse.json(
        { error: "fullName and email are required." },
        { status: 400 }
      );
    }

    // SECURITY: derive the company from the request's own Host header
    // instead of trusting a client-sent companyId — same cross-tenant
    // pattern fixed in mely-chat/route.ts. Without this, an inquiry (and
    // its notification/email) could be filed against a different company
    // than the one the visitor is actually on.
    const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id, park_id, contact_email")
      .eq("domain", host)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found for this domain." }, { status: 404 });
    }

    // If a listingId was given, confirm it actually belongs to this same
    // company's park before attaching it to the inquiry — otherwise
    // someone could tie an inquiry to another company's listing.
    let verifiedListingId: string | null = null;
    if (listingId) {
      const { data: listing } = await supabaseAdmin
        .from("real_estate_listings")
        .select("id, park_id")
        .eq("id", listingId)
        .maybeSingle();
      if (listing && listing.park_id === company.park_id) {
        verifiedListingId = listing.id;
      }
    }

    if (preferredDate) {
      const today = new Date().toISOString().split("T")[0];
      if (preferredDate < today) {
        return NextResponse.json(
          { error: "Preferred date can't be in the past." },
          { status: 400 }
        );
      }
    }

    const { error: insertError } = await supabaseAdmin.from("real_estate_inquiries").insert({
      company_id: company.id,
      listing_id: verifiedListingId,
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

    // Surface it in the admin's 🔔 Notifications bell too, not just email.
    await supabaseAdmin.from("resident_update_notifications").insert({
      company_id: company.id,
      resident_name: fullName,
      update_type: "real_estate_inquiry",
      message: `New appointment request${listingTitle ? ` for "${listingTitle}"` : ""} from ${fullName} (${email}${phone ? `, ${phone}` : ""}).`,
    });

    // Notify the company's own contact email (falls back to Mely's if unset).
    const notifyEmail = company.contact_email || process.env.APPLICATION_FEE_ADMIN_EMAIL || "melyos2026@gmail.com";

    if (process.env.RESEND_API_KEY) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "MelyOS <noreply@aloharvparkfl.com>",
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
