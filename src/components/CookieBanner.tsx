"use client";

import { useEffect, useState } from "react";

// Oct 23 (per Mely): cookie notice, like the big marina sites have. Shown once per browser.
// "Reject" keeps only what the site needs to work (sign-in, cart, this choice); the visit
// counter is skipped. "Accept" allows it. Works on every company website (RV and marina).
const KEY = "cookie_consent"; // "all" | "essential"

export function cookieConsent(): "all" | "essential" | null {
  try { const v = localStorage.getItem(KEY); return v === "all" || v === "essential" ? v : null; } catch { return null; }
}

export default function CookieBanner({ privacyHref = "/privacy", name }: { privacyHref?: string; name?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { if (!cookieConsent()) setShow(true); }, []);
  if (!show) return null;
  const choose = (v: "all" | "essential") => {
    try { localStorage.setItem(KEY, v); } catch {}
    setShow(false);
    window.dispatchEvent(new Event("cookie-consent"));
  };
  return (
    <div role="dialog" aria-label="Cookies" className="ck-banner">
      <div className="ck-text">
        <b>Cookies.</b> {name || "This website"} uses cookies that are needed for it to work (sign-in, orders) and, if you accept, a simple visit counter that helps us improve the site. No cookies are sold or shared for advertising. <a href={privacyHref}>Privacy Policy</a>
      </div>
      <div className="ck-actions">
        <button type="button" className="ck-btn ghost" onClick={() => choose("essential")}>Only what's needed</button>
        <button type="button" className="ck-btn" onClick={() => choose("all")}>Accept all</button>
      </div>
    </div>
  );
}
