import { NextResponse } from "next/server";
import sharp from "sharp";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 21 (per Mely — WhatsApp link preview without the logo): WhatsApp ignores
// big or slow preview images, and company logos are often large PNGs. This
// returns the logo as a small 1200×630 JPEG on a white card. It is made once
// per logo and kept in storage, so WhatsApp always gets it fast.
export const runtime = "nodejs";

const IMG_HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=604800" };

export async function GET(req: Request) {
  const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
  const { data: company } = await supabaseAdmin.from("public_company_profile").select("id, logo_url").eq("domain", host).maybeSingle();
  const logoUrl = company?.logo_url || (host.includes("aloharvparkfl.com") ? `https://${host}/aloha-logo.png` : null);
  if (!company?.id || !logoUrl) return NextResponse.json({ error: "No logo" }, { status: 404 });

  const key = createHash("sha1").update(logoUrl).digest("hex").slice(0, 12);
  const path = `${company.id}/share/og-${key}.jpg`;

  // Already made for this logo: serve it straight from storage.
  const cached = await supabaseAdmin.storage.from("company-assets").download(path);
  if (cached.data) return new NextResponse(new Uint8Array(await cached.data.arrayBuffer()), { headers: IMG_HEADERS });

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) throw new Error(`logo ${res.status}`);
    const logo = await sharp(Buffer.from(await res.arrayBuffer())).resize(560, 560, { fit: "inside" }).png().toBuffer();
    const jpg = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#ffffff" } })
      .composite([{ input: logo, gravity: "center" }])
      .jpeg({ quality: 78 })
      .toBuffer();
    await supabaseAdmin.storage.from("company-assets").upload(path, jpg, { contentType: "image/jpeg", upsert: true });
    return new NextResponse(new Uint8Array(jpg), { headers: IMG_HEADERS });
  } catch {
    return NextResponse.redirect(logoUrl);
  }
}
