"use client";

import { useEffect, useRef, useState } from "react";
import { usePortalLang } from "@/lib/portalI18n";

// Oct 29 (per Mely — "View as resident"): fixed banner on every /residents page while a park
// manager is viewing the portal as a resident (read only — the server refuses every write; see
// src/lib/residentViewAs.ts). "Exit" ends the view and clears its cookie.
export default function ViewAsBanner() {
  const [name, setName] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const { t } = usePortalLang();

  useEffect(() => {
    let alive = true;
    fetch("/api/portal/view-as", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.active) setName(String(d.residentName || "Resident"));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Fixed bar: push the page down by its real height (it wraps to 2–3 lines on a phone) and
  // move the site's sticky header below it (globals.css: body.va-on).
  useEffect(() => {
    if (!name) return;
    const el = barRef.current;
    const body = document.body;
    const apply = () => {
      const h = el ? el.offsetHeight : 56;
      body.style.paddingTop = h + "px";
      body.style.setProperty("--va-h", h + "px");
    };
    body.classList.add("va-on");
    apply();
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(apply) : null;
    if (ro && el) ro.observe(el);
    return () => {
      ro?.disconnect();
      body.classList.remove("va-on");
      body.style.paddingTop = "";
      body.style.removeProperty("--va-h");
    };
  }, [name]);

  if (!name) return null;

  async function exit() {
    setExiting(true);
    await fetch("/api/portal/view-as/exit", { method: "POST" }).catch(() => {});
    try {
      localStorage.removeItem("resident_id");
      localStorage.removeItem("resident_name");
    } catch {}
    window.close(); // the admin opened this tab; if the browser keeps it open, leave the portal
    window.location.replace("/login");
  }

  return (
    <div ref={barRef} role="status" className="va-bar">
      <div className="va-bar-in">
        <div className="va-bar-text">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>
            <b>{t("Viewing as {name} — read only", { name })}</b>
            <small>{t("Nothing can be paid, signed or changed.")}</small>
          </span>
        </div>
        <button type="button" onClick={exit} disabled={exiting} className="va-exit">
          {exiting ? t("Exiting…") : t("Exit")}
        </button>
      </div>
    </div>
  );
}
