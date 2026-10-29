"use client";

import { useEffect, useState } from "react";
import { usePortalLang } from "@/lib/portalI18n";

// Oct 29 (per Mely — "View as resident"): fixed banner on every /residents page while a park
// manager is viewing the portal as a resident (read only — the server refuses every write; see
// src/lib/residentViewAs.ts). "Exit" ends the view and clears its cookie.
export default function ViewAsBanner() {
  const [name, setName] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);
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

  useEffect(() => {
    if (!name) return;
    document.body.style.paddingTop = "48px";
    return () => {
      document.body.style.paddingTop = "";
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
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[9999] min-h-[48px] bg-amber-400 text-amber-950 shadow-md px-3 py-2 flex items-center justify-center gap-3 text-sm font-semibold"
    >
      <span className="text-center">
        {t("Viewing as {name} — read only. Nothing can be paid, signed or changed.", { name })}
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        className="shrink-0 rounded-md bg-amber-950 text-white px-3 py-1 text-xs font-bold hover:bg-black disabled:opacity-60"
      >
        {exiting ? t("Exiting…") : t("Exit")}
      </button>
    </div>
  );
}
