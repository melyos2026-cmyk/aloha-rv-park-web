import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabase } from "@/lib/supabase";

// Oct 21 (per Mely — WhatsApp link preview without the logo): WhatsApp ignores
// large preview images, and company logos are often big PNGs. This returns the
// company's logo as a small 1200×630 JPEG on a white card, made for link previews.
export const revalidate = 86400;

export async function GET(req: Request) {
  const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
  const { data: company } = await supabase.from("public_company_profile").select("logo_url").eq("domain", host).maybeSingle();
  const logoUrl = company?.logo_url || (host.includes("aloharvparkfl.com") ? `https://${host}/aloha-logo.png` : null);
  if (!logoUrl) return NextResponse.json({ error: "No logo" }, { status: 404 });
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) throw new Error(`logo ${res.status}`);
    const logo = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(560, 560, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const jpg = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#ffffff" } })
      .composite([{ input: logo, gravity: "center" }])
      .jpeg({ quality: 80 })
      .toBuffer();
    return new NextResponse(new Uint8Array(jpg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch {
    return NextResponse.redirect(logoUrl);
  }
}
