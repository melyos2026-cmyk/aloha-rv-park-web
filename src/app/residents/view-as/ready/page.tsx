"use client";

import { useEffect, useState } from "react";
import { usePortalLang } from "@/lib/portalI18n";

// Oct 29 (per Mely — "View as resident"): landing page after /residents/view-as exchanged the
// one-time link. Confirms the read-only view with the server, points the portal pages (they read
// localStorage resident_id) at that resident, then opens the dashboard.
// English keys; shown through t() (src/lib/portalI18n.ts).
const ERRORS_ENDED = "This view has ended. Open it again from the admin.";
const ERRORS_FAILED = "Could not open the resident portal. Please try again.";
const ERRORS: Record<string, string> = {
  invalid: "This link is invalid, expired or was already used. Open it again from the admin.",
  other_park: "This link only works on the park's own website.",
  not_allowed: "You are no longer allowed to view this resident's portal.",
};

export default function ViewAsReadyPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = usePortalLang();
  const open = () => {
    if (!pending) return;
    try {
      localStorage.setItem("resident_id", pending.id);
      localStorage.setItem("resident_name", pending.name);
    } catch {}
    window.location.replace("/residents/dashboard");
  };
  const cancel = async () => {
    setBusy(true);
    await fetch("/api/portal/view-as/exit", { method: "POST" }).catch(() => null);
    window.location.replace("/residents");
  };

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      setError(ERRORS[err] || ERRORS.invalid);
      return;
    }
    fetch("/api/portal/view-as", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.active || !d.residentId) {
          setError(ERRORS_ENDED);
          return;
        }
        // Review: ask first — someone who isn't park staff (e.g. a resident sent this link) can cancel.
        setPending({ id: String(d.residentId), name: String(d.residentName || "") });
      })
      .catch(() => setError(ERRORS_FAILED));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-md w-full text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">{t("View as resident")}</h1>
            <p className="text-sm text-gray-600 mt-2">{t(error)}</p>
          </>
        ) : pending ? (
          <>
            <h1 className="text-lg font-semibold text-gray-900">{t("Park staff only")}</h1>
            <p className="text-sm text-gray-600 mt-2">
              {t("You are opening {name}'s portal as park staff, read only. Nothing can be paid, signed or changed.", { name: pending.name || t("this resident") })}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={cancel} disabled={busy} className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700">{t("I'm not park staff")}</button>
              <button type="button" onClick={open} disabled={busy} className="px-4 py-2 rounded-lg bg-black text-white text-sm font-semibold">{t("Open read-only view")}</button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">{t("Opening the resident portal (read only)…")}</p>
        )}
      </div>
    </main>
  );
}
