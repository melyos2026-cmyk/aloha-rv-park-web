import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { hostnameFromRequest } from "@/lib/marina/host";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

// POST /api/marketplace-contact-seller
// Body: { listingId, buyerName, buyerEmail, buyerPhone, message }
// Sends the buyer's contact info + message to the seller's own email —
// keeps the seller's personal contact info off the public listing itself.
// Oct 20 (security review): everything the buyer types is inserted into
// an HTML email sent from the park's own address — escape it so nobody can
// inject links/markup (phishing) into the seller's inbox.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: NextRequest) {
  // Oct 26 (security review): at most 5 messages to sellers per device per hour (spam).
  if (await tooManyFromIp(req, "marketplace-contact-seller", 5)) {
    return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  }
  const body = await req.json();
  const listingId = body?.listingId;
  // Oct 20 (security review): trim + cap lengths on the free-text fields.
  const buyerName = String(body?.buyerName ?? "").trim().slice(0, 120);
  const buyerEmail = String(body?.buyerEmail ?? "").trim().slice(0, 160);
  const buyerPhone = String(body?.buyerPhone ?? "").trim().slice(0, 40);
  const message = String(body?.message ?? "").trim().slice(0, 3000);

  if (!listingId || !buyerName || !buyerEmail || !message) {
    return NextResponse.json({ error: "Please fill in your name, email, and a message." }, { status: 400 });
  }
  // Oct 20 (security review): reply_to must be a real-looking single address.
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(buyerEmail)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  // Oct 22 (per Mely): works for residents' (RV) and boaters' (marina) items, only for an active
  // item of the park/marina whose website this is, and the email carries that park's own name.
  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("*, resident_accounts(full_name, email), companies(company_name, domain)")
    .eq("id", listingId)
    .eq("status", "active")
    .maybeSingle();

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }
  const host = hostnameFromRequest(req);
  const siteDomain = String((listing as any).companies?.domain || "").toLowerCase().replace(/^www\./, "");
  if (host && siteDomain && !host.endsWith(".vercel.app") && host !== "localhost" && host !== siteDomain) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  let sellerEmail = (listing as any).resident_accounts?.email;
  let sellerName = (listing as any).resident_accounts?.full_name || "there";
  if ((listing as any).member_id) {
    const { data: m } = await supabase.from("marina_members").select("full_name, email").eq("id", (listing as any).member_id).eq("company_id", (listing as any).company_id).maybeSingle();
    sellerEmail = m?.email || null;
    sellerName = m?.full_name || "there";
  }
  const placeName = (listing as any).companies?.company_name || "Community";

  if (!sellerEmail) {
    return NextResponse.json({ error: "This seller has no email on file." }, { status: 400 });
  }

  if (process.env.RESEND_API_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${placeName.replace(/[<>"]/g, "")} Marketplace <noreply@aloharvparkfl.com>`,
          to: sellerEmail,
          reply_to: buyerEmail,
          subject: `Someone is interested in your listing: ${listing.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>🛍️ New Marketplace Inquiry</h2>
              <p>Hi ${escapeHtml(sellerName)},</p>
              <p><strong>${escapeHtml(buyerName)}</strong> is interested in your listing "<strong>${escapeHtml(listing.title)}</strong>":</p>
              <blockquote style="border-left: 3px solid #16a34a; padding-left: 12px; color: #333; white-space: pre-wrap;">${escapeHtml(message)}</blockquote>
              <p><strong>Contact them back:</strong><br/>Email: ${escapeHtml(buyerEmail)}${buyerPhone ? `<br/>Phone: ${escapeHtml(buyerPhone)}` : ""}</p>
              <p style="font-size:12px;color:#888;">You can also just reply directly to this email.</p>
            </div>
          `,
        }),
      });
    } catch (err) {
      console.error("Failed to send marketplace contact email:", err);
      return NextResponse.json({ error: "Could not send your message. Please try again." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
