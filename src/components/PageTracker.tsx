"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

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

  useEffect(() => {
    const visitorId = getVisitorId();

    fetch("/api/track-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathname,
        referrer: document.referrer || null,
        visitorId,
      }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
