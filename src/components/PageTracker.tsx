"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/CompanyContext";
import { cookieConsent } from "@/components/CookieBanner";

function getVisitorId() {
  let id = localStorage.getItem("visitor_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("visitor_id", id);
  }
  return id;
}

export default function PageTracker() {
  const pathname = usePathname();
  const { company } = useCompany();

  const [consent, setConsent] = useState(cookieConsent());
  useEffect(() => {
    const on = () => setConsent(cookieConsent());
    window.addEventListener("cookie-consent", on);
    return () => window.removeEventListener("cookie-consent", on);
  }, []);

  useEffect(() => {
    if (!company?.id) return; // don't record a view we can't attribute to a company
    if (consent !== "all") return; // Oct 23: the visit counter only runs when cookies were accepted
    const visitorId = getVisitorId();

    fetch("/api/track-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathname,
        referrer: document.referrer || null,
        visitorId,
        companyId: company.id,
      }),
    }).catch(() => {});
  }, [pathname, company?.id, consent]);

  return null;
}
