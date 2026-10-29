"use client";

// Oct 29 (per the owner): EN / ES / PT / FR / HT switch for the resident portal (header, menu, login page).
// Five buttons on wider screens; on phones (≤ 560px) a compact dropdown instead, so it always fits.
// Saves the choice in this browser and, when residentId is given, on the resident's account.
// Inline styles on purpose (Tailwind doesn't generate CSS in production on this site).
import { PORTAL_LANGS, usePortalLang, type PortalLang } from "@/lib/portalI18n";

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
  const choose = (code: PortalLang) => { if (code !== lang) setLang(code, residentId || signedInResidentId()); };
  return (
    <div style={{ display: "inline-flex", flexShrink: 0, ...style }}>
      <style>{`.portal-lang-select{display:none}@media (max-width:560px){.portal-lang-buttons{display:none!important}.portal-lang-select{display:inline-block}}`}</style>
      <div
        role="group"
        aria-label={t("Choose your language")}
        className="portal-lang-buttons"
        style={{ display: "inline-flex", border: "1.5px solid #000", borderRadius: 6, overflow: "hidden", background: "#fff", flexShrink: 0 }}
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
              onClick={() => choose(l.code)}
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
      <select
        className="portal-lang-select"
        aria-label={t("Choose your language")}
        value={lang}
        onChange={(e) => choose(e.target.value as PortalLang)}
        style={{
          border: "1.5px solid #000",
          borderRadius: 6,
          background: "#fff",
          color: "#000",
          padding: compact ? "5px 6px" : "8px 8px",
          fontSize: compact ? 13 : 14,
          fontWeight: 700,
          lineHeight: 1.2,
          maxWidth: "100%",
          cursor: "pointer",
        }}
      >
        {PORTAL_LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>{l.label} · {l.name}</option>
        ))}
      </select>
    </div>
  );
}
