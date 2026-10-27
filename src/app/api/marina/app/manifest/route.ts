import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";

// GET /api/marina/app/manifest — Oct 26 (per Mely): the boater account installs on the phone as the
// marina's own app ("Add to Home Screen"): the marina's name and icon, opens straight into the
// boater account without the browser bar. Computed per domain, so every marina gets its own app.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const name = company.company_name || "Marina";
  const color = /^#[0-9a-f]{3,8}$/i.test(String(company.primary_color || "")) ? company.primary_color! : "#0f2540";
  const short = name.length <= 12 ? name : name.replace(/\b(marina|the|and|&)\b/gi, "").trim().slice(0, 12) || "Marina";
  return NextResponse.json(
    {
      id: "/marina/account",
      name: `${name} — Boater`,
      short_name: short,
      description: `Your boater account at ${name}: pay, sign, documents, messages and your marina pass.`,
      start_url: "/marina/account",
      scope: "/marina",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: color,
      orientation: "portrait",
      icons: [
        { src: "/api/marina/app/icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/api/marina/app/icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/api/marina/app/icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
