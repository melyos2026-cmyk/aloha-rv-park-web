import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = await req.json();
  const { path, referrer, visitorId } = body;

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

  await supabase.from("page_views").insert({
    path: path || "/",
    referrer: referrer || null,
    visitor_id: visitorId || null,
    ip_address: ip,
    city,
    region,
    country,
  });

  return NextResponse.json({ success: true });
}
