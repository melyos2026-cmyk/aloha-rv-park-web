import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();
  const { path, referrer, visitorId } = body;

  // SECURITY: derive company_id from the request's own Host header instead
  // of trusting the client-sent companyId — same cross-tenant pattern fixed
  // in mely-chat/route.ts. Prevents page-view analytics from being tagged
  // to the wrong company (accidentally or by a spoofed request).
  const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("id")
    .eq("domain", host)
    .maybeSingle();

  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  let city = null;
  let region = null;
  let country = null;

  if (ip && ip !== "::1" && ip !== "127.0.0.1") {
    try {
      const geoRes = await fetch(
        `http://ip-api.com/json/${ip}?fields=status,city,regionName,country`
      );
      const geoData = await geoRes.json();
      if (geoData.status === "success") {
        city = geoData.city || null;
        region = geoData.regionName || null;
        country = geoData.country || null;
      }
    } catch (e) {
      // Geolocation failed, continue without it
    }
  }

  const { error } = await supabaseAdmin.from("page_views").insert({
    path: path || "/",
    referrer: referrer || null,
    visitor_id: visitorId || null,
    ip_address: ip,
    city,
    region,
    country,
    company_id: company?.id || null,
  });

  if (error) {
    console.error("track-visit insert error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
