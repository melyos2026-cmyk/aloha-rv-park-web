import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Mely from "@/components/Mely";
import PageTracker from "@/components/PageTracker";
import { CompanyProvider } from "@/lib/CompanyContext";
import { COMPANY_COLUMNS } from "@/lib/companyColumns";
import { supabase } from "@/lib/supabase";
import { getMarinaForPage } from "@/lib/marina/company";
import { MarinaShell } from "@/components/marina/MarinaChrome";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const SCHEMA_TYPE_BY_BUSINESS_TYPE: Record<string, string> = {
  rv_park: "Campground",
  self_storage: "SelfStorage",
  marina: "LocalBusiness",
};

async function getHostCompany() {
  const headersList = await headers();
  const hostname = (headersList.get("host") || "")
    .replace(/^www\./, "")
    .split(":")[0];

  const { data } = await supabase
    .from("public_company_profile")
    .select("company_name, address, contact_phone, seo_description, business_type, logo_url, primary_color, secondary_color")
    .eq("domain", hostname)
    .maybeSingle();

  return data;
}

export async function generateMetadata(): Promise<Metadata> {
  const company = await getHostCompany();
  const isAloha = ((await headers()).get("host") || "").toLowerCase().includes("aloharvparkfl.com");

  // Link previews (iMessage, WhatsApp, Facebook, LinkedIn) for marina sites.
  const host = ((await headers()).get("host") || "").replace(/^www\./, "");
  const isMarina = company?.business_type === "marina";
  const marinaShare = isMarina
    ? (() => {
        const title = `${company?.company_name} Marina`;
        const description = company?.seo_description || `Slips, rates and online reservations at ${company?.company_name}.`;
        const image = company?.logo_url || `https://${host}/marina/og.png`;
        return {
          metadataBase: new URL(`https://${host}`),
          openGraph: { title, description, url: `https://${host}`, siteName: company?.company_name, type: "website" as const, images: [{ url: image, width: 1200, height: 630, alt: title }] },
          twitter: { card: "summary_large_image" as const, title, description, images: [image] },
        };
      })()
    : (() => {
        // Oct 21 (per Mely): link previews (WhatsApp, iMessage, Facebook) for RV parks
        // show the company's own logo; Aloha uses its logo file.
        const image = company?.logo_url || (isAloha ? `https://${host}/aloha-logo.png` : null);
        if (!company && !isAloha) return {};
        const title = company?.company_name || "Aloha RV Park – Kissimmee, Florida";
        const description = company?.seo_description || `${title}: RV sites, rates and online reservations.`;
        return {
          metadataBase: new URL(`https://${host}`),
          openGraph: { title, description, url: `https://${host}`, siteName: title, type: "website" as const, ...(image ? { images: [{ url: image, alt: title }] } : {}) },
          twitter: { card: (image ? "summary" : "summary") as "summary", title, description, ...(image ? { images: [image] } : {}) },
        };
      })();

  return {
    ...marinaShare,
    title: company?.company_name || "Aloha RV Park – Kissimmee, Florida",
    // Oct 9: tab icon per tenant. Aloha gets its compass; every other
    // company (Sunset Ridge, future clients) gets its own logo_url
    // automatically; no logo -> no custom icon.
    ...(isAloha
      ? {
          icons: {
            icon: [{ url: "/aloha-favicon.png", type: "image/png" }],
            apple: [{ url: "/aloha-apple.png" }],
          },
        }
      : company?.business_type === "marina" && !company?.logo_url
      ? { icons: { icon: [{ url: "/marina/favicon.svg", type: "image/svg+xml" }] } }
      : company?.logo_url
      ? { icons: { icon: [{ url: company.logo_url }], apple: [{ url: company.logo_url }] } }
      : {}),
    // Oct 21 (per Mely): a marina without its own SEO text must never show Aloha's address.
    description:
      company?.seo_description ||
      (company?.business_type === "marina"
        ? `${company.company_name}: open slips, rates, fuel dock and online boater accounts.`
        : "Your home away from home near Orlando, Disney World, Universal Studios & SeaWorld. 4648 S. Orange Blossom Trl, Kissimmee FL 34746"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await getHostCompany();
  // Marina domains get their own header, footer and styles; everything else
  // keeps the RV-park layout untouched.
  const marina = company?.business_type === "marina" ? await getMarinaForPage().catch(() => null) : null;
  // Oct 21 (per Mely): load the full company on the server so the first paint already shows the right park.
  let initialCompany: any = null;
  if (!marina) {
    const hostname = ((await headers()).get("host") || "").replace(/^www\./, "").split(":")[0];
    const { data } = await supabase.from("public_company_profile").select(COMPANY_COLUMNS).eq("domain", hostname).maybeSingle();
    initialCompany = data || null;
  }
  const schemaType = SCHEMA_TYPE_BY_BUSINESS_TYPE[company?.business_type || "rv_park"] || "LocalBusiness";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: company?.company_name || "Aloha RV Park",
    ...(company?.address ? { address: company.address } : {}),
    ...(company?.contact_phone ? { telephone: company.contact_phone } : {}),
    ...(company?.logo_url ? { image: company.logo_url } : {}),
    ...(company?.seo_description ? { description: company.seo_description } : {}),
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {(company?.primary_color || company?.secondary_color) && (
          <style
            dangerouslySetInnerHTML={{
              __html: `:root {
                ${company?.primary_color ? `--red: ${company.primary_color}; --red-dark: ${company.primary_color};` : ""}
                ${company?.secondary_color ? `--blue-accent: ${company.secondary_color};` : ""}
              }`,
            }}
          />
        )}
      </head>
      <body>
        {marina ? (
          <MarinaShell company={marina}>{children}</MarinaShell>
        ) : (
        <CompanyProvider initialCompany={initialCompany}>
          <Header />
          <main>{children}</main>
          <Footer />
          <Mely />
          <PageTracker />
        </CompanyProvider>
        )}
      </body>
    </html>
  );
}
