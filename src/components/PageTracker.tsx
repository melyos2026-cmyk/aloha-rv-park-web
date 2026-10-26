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

  // Oct 26 (per Mely): personal demo link (marinademo.melyos.io/?d=…). The link was made for this
  // person, so each page they open is logged and Mely gets an email when they arrive. Kept only for
  // this tab (sessionStorage), and only on the demo marina.
  useEffect(() => {
    if (!company?.domain || !/^marinademo\./.test(String(company.domain))) return;
    let d: string | null = null, sid: string | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get("d");
      if (q) sessionStorage.setItem("melyos_demo_ref", q.slice(0, 40));
      d = sessionStorage.getItem("melyos_demo_ref");
      sid = sessionStorage.getItem("melyos_demo_sid") || crypto.randomUUID();
      sessionStorage.setItem("melyos_demo_sid", sid);
    } catch {}
    if (!d) return;
    fetch("/api/demo-visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d, s: sid, path: pathname }) }).catch(() => {});
  }, [pathname, company?.domain]);

  return null;
}
