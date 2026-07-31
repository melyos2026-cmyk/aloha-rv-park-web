"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/CompanyContext";

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

  useEffect(() => {
    if (!company?.id) return; // don't record a view we can't attribute to a company
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
  }, [pathname, company?.id]);

  return null;
}
