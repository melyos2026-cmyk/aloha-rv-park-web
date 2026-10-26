import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Oct 26 (security review): every visitor field is escaped before going into the email HTML,
// and stripped of < > in the admin bell text, so a visitor can't inject links/markup.
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
const plain = (v: unknown) => String(v ?? "").replace(/[<>\u0000-\u001f]/g, " ").trim();
// Oct 26 (security review): length caps on every visitor field.
const cap = (v: unknown, n: number) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "");

export async function POST(req: NextRequest) {
  try {
    // Oct 26 (security review): at most 5 inquiries per device per hour (spam / email flooding).
    if (await tooManyFromIp(req, "real-estate-inquiry", 5)) {
      return NextResponse.json({ error: "Too many requests. Please try again later or call the office." }, { status: 429 });
    }
    const body = await req.json();
    const listingId = cap(body.listingId, 64) || null;
    const listingTitle = cap(body.listingTitle, 200);
    const fullName = cap(body.fullName, 120);
    const email = cap(body.email, 160);
    const phone = cap(body.phone, 40);
    const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(cap(body.preferredDate, 10)) ? cap(body.preferredDate, 10) : "";
    const preferredTime = cap(body.preferredTime, 40);
    const message = cap(body.message, 2000);

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
      .select("id, park_id, contact_email, company_name")
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
      message: `New appointment request${listingTitle ? ` for "${plain(listingTitle)}"` : ""} from ${plain(fullName)} (${plain(email)}${phone ? `, ${plain(phone)}` : ""}).`,
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
            from: `${company?.company_name || "Aloha RV Park"} <noreply@aloharvparkfl.com>`,
            to: notifyEmail,
            subject: `New appointment request${listingTitle ? `: ${plain(listingTitle)}` : ""} from ${plain(fullName)}`.replace(/[\r\n]+/g, " "),
            html: `
              <p>${escapeHtml(fullName)} requested an appointment${listingTitle ? ` about "${escapeHtml(listingTitle)}"` : ""}.</p>
              <ul>
                <li>Email: ${escapeHtml(email)}</li>
                <li>Phone: ${escapeHtml(phone || "not provided")}</li>
                <li>Preferred date/time: ${escapeHtml(preferredDate || "not specified")} ${escapeHtml(preferredTime)}</li>
                ${message ? `<li>Message: ${escapeHtml(message)}</li>` : ""}
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
