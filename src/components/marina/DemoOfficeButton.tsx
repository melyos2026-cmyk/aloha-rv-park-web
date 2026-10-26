"use client";

import { useEffect, useState } from "react";

// Oct 26 (per Mely): from the office tour, open the real demo office (one click, no password).
// Carries the personal demo link (?d=…) so Mely knows that prospect went in.
const OFFICE = "https://adminmarinademo.melyos.io/";

export default function DemoOfficeButton({ className = "mr-btn", label = "Try the office yourself" }: { className?: string; label?: string }) {
  const [href, setHref] = useState(OFFICE);
  useEffect(() => {
    try { const d = sessionStorage.getItem("melyos_demo_ref"); if (d) setHref(`${OFFICE}?d=${encodeURIComponent(d)}`); } catch {}
  }, []);
  return <a className={className} href={href} target="_blank" rel="noopener">{label}</a>;
}
