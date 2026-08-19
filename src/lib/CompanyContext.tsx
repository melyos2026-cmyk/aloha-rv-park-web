"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

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

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
      .select("id, company_name, address, logo_url, domain, contact_email, contact_phone, ai_assistant_info, park_id, hero_image_url, rate_daily, rate_weekly, rate_monthly_offpeak, rate_monthly_peak, events_calendar_pdf_url")
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
