import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Mely from "@/components/Mely";
import PageTracker from "@/components/PageTracker";
import { CompanyProvider } from "@/lib/CompanyContext";
import { supabase } from "@/lib/supabase";

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
    .from("companies")
    .select("company_name, address, contact_phone, seo_description, business_type, logo_url, primary_color, secondary_color")
    .eq("domain", hostname)
    .maybeSingle();

  return data;
}

export async function generateMetadata(): Promise<Metadata> {
  const company = await getHostCompany();

  return {
    title: company?.company_name || "Aloha RV Park – Kissimmee, Florida",
    description:
      company?.seo_description ||
      "Your home away from home near Orlando, Disney World, Universal Studios & SeaWorld. 4648 S. Orange Blossom Trl, Kissimmee FL 34746",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await getHostCompany();
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
        <CompanyProvider>
          <Header />
          <main>{children}</main>
          <Footer />
          <Mely />
          <PageTracker />
        </CompanyProvider>
      </body>
    </html>
  );
}
