import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Mely from "@/components/Mely";
import PageTracker from "@/components/PageTracker";
import { CompanyProvider } from "@/lib/CompanyContext";
import { supabase } from "@/lib/supabase";

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
    .select("company_name, address, contact_phone, seo_description, business_type, logo_url")
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
