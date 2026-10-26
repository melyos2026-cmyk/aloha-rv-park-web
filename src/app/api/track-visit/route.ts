import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  // Oct 26 (security review): at most 300 page views per device per hour (no flooding the stats
  // table or the geolocation lookup).
  if (await tooManyFromIp(req, "track-visit", 300)) {
    return NextResponse.json({ success: false }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  // Oct 26 (security review): cap lengths — these go straight into page_views.
  const capStr = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
  const path = capStr(body?.path, 500);
  const referrer = capStr(body?.referrer, 500);
  const visitorId = capStr(body?.visitorId, 100);

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
