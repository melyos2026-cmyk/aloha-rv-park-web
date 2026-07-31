import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();
  const { path, referrer, visitorId, companyId } = body;

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
    company_id: companyId || null,
  });

  if (error) {
    console.error("track-visit insert error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
