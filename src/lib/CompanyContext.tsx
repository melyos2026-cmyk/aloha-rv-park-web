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
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      hostname = process.env.NEXT_PUBLIC_DEV_COMPANY_DOMAIN || hostname;
    }
    hostname = hostname.replace(/^www\./, "");

    supabase
      .from("companies")
      .select("id, company_name, address, logo_url, domain, contact_email, contact_phone, ai_assistant_info, park_id")
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
