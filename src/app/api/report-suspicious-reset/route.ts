import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function htmlPage(title: string, message: string) {
  return `
    <html>
      <head><title>${title}</title></head>
      <body style="font-family: Arial, sans-serif; max-width: 480px; margin: 80px auto; text-align: center; color: #111;">
        <h2>${title}</h2>
        <p style="color: #444; line-height: 1.6;">${message}</p>
      </body>
    </html>
  `;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse(htmlPage("Invalid link", "This link is missing information and can't be processed."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const { data: resetRow } = await supabaseAdmin
    .from("resident_password_resets")
    .select("id, resident_id, request_ip, created_at, reported_suspicious")
    .eq("token", token)
    .maybeSingle();

  if (!resetRow) {
    return new NextResponse(htmlPage("Link not found", "This reset link is no longer valid, so there's nothing to report."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (resetRow.reported_suspicious) {
    return new NextResponse(htmlPage("Already reported", "The office has already been notified about this request."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const { data: resident } = await supabaseAdmin
    .from("resident_accounts")
    .select("full_name, email, company_id")
    .eq("id", resetRow.resident_id)
    .maybeSingle();

  if (resident?.company_id) {
    const requestedAt = new Date(resetRow.created_at).toLocaleString("en-US", { timeZone: "America/New_York" });

    let locationText = "";
    if (resetRow.request_ip) {
      try {
        const geoRes = await fetch(
          `http://ip-api.com/json/${resetRow.request_ip}?fields=status,city,regionName,country`
        );
        const geoData = await geoRes.json();
        if (geoData.status === "success") {
          const parts = [geoData.city, geoData.regionName, geoData.country].filter(Boolean);
          if (parts.length) locationText = ` (approximately ${parts.join(", ")})`;
        }
      } catch (e) {
        // Geolocation failed — fall back to just the IP below
      }
    }

    await supabaseAdmin.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_name: resident.full_name || resident.email || "Unknown resident",
      update_type: "security_alert",
      message: `${resident.full_name || resident.email} reported a password reset email they did NOT request, sent ${requestedAt}${resetRow.request_ip ? ` from IP ${resetRow.request_ip}${locationText}` : " (no IP captured)"}.`,
    });
  }

  await supabaseAdmin
    .from("resident_password_resets")
    .update({ reported_suspicious: true })
    .eq("id", resetRow.id);

  return new NextResponse(
    htmlPage("Thanks for letting us know", "The office has been notified that you did not request this password reset. If you're concerned about your account, please call the office directly."),
    { headers: { "Content-Type": "text/html" } }
  );
}
