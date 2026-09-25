import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { supabase } from "@/lib/supabase";

// GET /api/resident-manifest
// Sep 25 (per Mely — wants the resident portal installable as its own
// app on phone/tablet/computer, same as the admin dashboard and Propane
// Scanner PWAs today): this repo is multi-tenant (Aloha and Sunset Ridge
// share the same deployed code, told apart by domain) and this same
// layout also serves the whole public marketing site — a static
// manifest.json at the root would make the ENTIRE public site
// installable, and would show the SAME name/icon for every company. A
// real route computed per-request avoids both: only /residents links to
// this (via app/residents/layout.tsx), and it reads the requesting
// domain to serve each company's own name/logo automatically, with no
// extra icon asset to keep in sync as new companies get added.
export async function GET(req: NextRequest) {
  const headersList = await headers();
  const hostname = (headersList.get("host") || "").replace(/^www\./, "").split(":")[0];

  const { data: company } = await supabase
    .from("public_company_profile")
    .select("company_name, logo_url, primary_color")
    .eq("domain", hostname)
    .maybeSingle();

  const companyName = company?.company_name || "Resident Portal";
  const icon = company?.logo_url || "/aloha-logo.png";
  const themeColor = company?.primary_color || "#0b1f3a";

  const manifest = {
    name: `${companyName} — Resident Portal`,
    short_name: "Resident Portal",
    description: `Manage your balance, payments, documents, and maintenance requests for ${companyName}.`,
    start_url: "/residents/dashboard",
    scope: "/residents",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: themeColor,
    orientation: "any",
    icons: [
      { src: icon, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return NextResponse.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
