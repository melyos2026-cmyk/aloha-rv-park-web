import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// POST /api/marketplace-contact-seller
// Body: { listingId, buyerName, buyerEmail, buyerPhone, message }
// Sends the buyer's contact info + message to the seller's own email —
// keeps the seller's personal contact info off the public listing itself.
export async function POST(req: NextRequest) {
  const { listingId, buyerName, buyerEmail, buyerPhone, message } = await req.json();

  if (!listingId || !buyerName || !buyerEmail || !message) {
    return NextResponse.json({ error: "Please fill in your name, email, and a message." }, { status: 400 });
  }

  const { data: listing } = await supabase
    .from("marketplace_listings")
    .select("title, resident_id, resident_accounts(full_name, email)")
    .eq("id", listingId)
    .single();

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const sellerEmail = (listing as any).resident_accounts?.email;
  const sellerName = (listing as any).resident_accounts?.full_name || "there";

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
          from: "Aloha RV Park Marketplace <onboarding@resend.dev>",
          to: sellerEmail,
          reply_to: buyerEmail,
          subject: `Someone is interested in your listing: ${listing.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>🛍️ New Marketplace Inquiry</h2>
              <p>Hi ${sellerName},</p>
              <p><strong>${buyerName}</strong> is interested in your listing "<strong>${listing.title}</strong>":</p>
              <blockquote style="border-left: 3px solid #16a34a; padding-left: 12px; color: #333;">${message}</blockquote>
              <p><strong>Contact them back:</strong><br/>Email: ${buyerEmail}${buyerPhone ? `<br/>Phone: ${buyerPhone}` : ""}</p>
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
