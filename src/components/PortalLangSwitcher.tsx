"use client";

// Oct 29 (per the owner): EN / ES / PT switch for the resident portal (header, menu, login page).
// Saves the choice in this browser and, when residentId is given, on the resident's account.
// Inline styles on purpose (Tailwind doesn't generate CSS in production on this site).
import { PORTAL_LANGS, usePortalLang } from "@/lib/portalI18n";

// Oct 29: the switch on the other /residents pages (no residentId prop) also saves the choice on the
// signed-in resident's account, so their phone alerts follow it. Not on login / pay-link pages.
function signedInResidentId(): string | null {
  try {
    const p = window.location.pathname;
    if (!p.startsWith("/residents") && !p.startsWith("/electric-history")) return null;
    return window.localStorage.getItem("resident_id");
  } catch {
    return null;
  }
}

export default function PortalLangSwitcher({
  residentId = null,
  compact = false,
  style,
}: {
  residentId?: string | null;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  const { lang, setLang, t } = usePortalLang();
  return (
    <div
      role="group"
      aria-label={t("Choose your language")}
      style={{ display: "inline-flex", border: "1.5px solid #000", borderRadius: 6, overflow: "hidden", background: "#fff", flexShrink: 0, ...style }}
    >
      {PORTAL_LANGS.map((l, i) => {
        const on = l.code === lang;
        return (
          <button
            key={l.code}
            type="button"
            lang={l.code}
            title={l.name}
            aria-label={l.name}
            aria-pressed={on}
            onClick={() => { if (!on) setLang(l.code, residentId || signedInResidentId()); }}
            style={{
              background: on ? "#000" : "transparent",
              color: on ? "#fff" : "#000",
              border: "none",
              borderLeft: i === 0 ? "none" : "1.5px solid #000",
              padding: compact ? "6px 9px" : "9px 12px",
              fontSize: compact ? 12 : 13,
              fontWeight: 800,
              letterSpacing: "0.04em",
              cursor: on ? "default" : "pointer",
              lineHeight: 1,
            }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
