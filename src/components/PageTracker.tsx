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

  // Oct 26 (per Mely): the demo marina is only visited by prospects, so every visit is logged and
  // Mely gets an email when someone arrives (with a personal link ?d=… it carries their name). Only
  // on the demo marina; the link is kept for this tab only (sessionStorage).
  useEffect(() => {
    if (!company?.domain || !/^marinademo\./.test(String(company.domain))) return;
    let d: string | null = null, sid: string | null = null, me = false;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("d")) sessionStorage.setItem("melyos_demo_ref", q.get("d")!.slice(0, 40));
      if (q.get("me") === "1") localStorage.setItem("melyos_demo_me", "1"); // Mely's own devices: never logged
      me = localStorage.getItem("melyos_demo_me") === "1";
      d = sessionStorage.getItem("melyos_demo_ref");
      sid = sessionStorage.getItem("melyos_demo_sid") || crypto.randomUUID();
      sessionStorage.setItem("melyos_demo_sid", sid);
    } catch {}
    if (me) return;
    fetch("/api/demo-visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ d, s: sid, path: pathname }) }).catch(() => {});
  }, [pathname, company?.domain]);

  return null;
}
