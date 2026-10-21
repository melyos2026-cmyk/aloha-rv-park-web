"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { COMPANY_COLUMNS } from "@/lib/companyColumns";

export interface Company {
  id: string;
  company_name: string;
  address: string | null;
  logo_url: string | null;
  domain: string;
  contact_email: string | null;
  contact_phone: string | null;
  ai_assistant_info: string | null;
  park_id: string | null;
  hero_image_url: string | null;
  hero_location_label: string | null;
  hero_headline: string | null;
  hero_subtext: string | null;
  rate_daily: string | null;
  rate_weekly: string | null;
  rate_monthly_offpeak: string | null;
  rate_monthly_peak: string | null;
  events_calendar_pdf_url: string | null;
}

interface CompanyContextValue {
  company: Company | null;
  loading: boolean;
  error: string | null;
}

const CompanyContext = createContext<CompanyContextValue>({
  company: null,
  loading: true,
  error: null,
});

// Oct 21 (per Mely): the server already knows the company for this domain, so it
// hands it over on the first paint — no flash of Aloha's logo/name/photo on
// another company's site while the browser looks it up.

export function CompanyProvider({ children, initialCompany = null }: { children: ReactNode; initialCompany?: Company | null }) {
  const [company, setCompany] = useState<Company | null>(initialCompany);
  const [loading, setLoading] = useState(!initialCompany);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCompany) return;
    let hostname =
      typeof window !== "undefined" ? window.location.hostname : "";
    // Aug 12 (per Mely): Vercel preview deployments use random
    // *.vercel.app subdomains that never match any real company's
    // registered domain — same problem as localhost, same fix. Scoped
    // narrowly to *.vercel.app so this never affects the real production
    // domain (aloharvparkfl.com).
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".vercel.app")
    ) {
      hostname = process.env.NEXT_PUBLIC_DEV_COMPANY_DOMAIN || hostname;
    }
    hostname = hostname.replace(/^www\./, "");

    supabase
      .from("public_company_profile")
      .select(COMPANY_COLUMNS)
      .eq("domain", hostname)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError(err?.message || `No company found for domain "${hostname}"`);
        } else {
          setCompany(data as Company);
        }
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CompanyContext.Provider value={{ company, loading, error }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
