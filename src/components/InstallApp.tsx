"use client";

import { useEffect, useState } from "react";

// Oct 26 (per Mely): "install the app" card for the boater account and the resident portal.
// · Android / Chrome / Edge: one button (the browser's own install prompt).
// · iPhone / iPad: Safari has no button, so it shows the two taps (Share → Add to Home Screen).
// · Already installed, or dismissed in the last 14 days: shows nothing.
// Also keeps the number on the app icon in sync with what needs attention (appBadge).

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIP; window.dispatchEvent(new Event("melyos-installable")); });
}

const KEY = "melyos_install_dismissed";
const isStandalone = () => {
  try { return window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true; } catch { return false; }
};

/** Number on the installed app's icon (Android, iPhone 16.4+, desktop). */
export function useAppBadge(n: number) {
  useEffect(() => {
    const nav = navigator as any;
    try {
      if (n > 0 && nav.setAppBadge) nav.setAppBadge(n).catch(() => {});
      else if (nav.clearAppBadge) nav.clearAppBadge().catch(() => {});
    } catch {}
  }, [n]);
}

/** Render anywhere (e.g. after early returns) to set the app-icon number. */
export function AppBadge({ n }: { n: number }) {
  useAppBadge(n);
  return null;
}

export default function InstallApp({ appName, accent = "#0f2540", compact = false }: { appName: string; accent?: string; compact?: boolean }) {
  const [mode, setMode] = useState<"none" | "button" | "ios">("none");
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    let dismissedAt = 0;
    try { dismissedAt = Number(localStorage.getItem(KEY) || 0); } catch {}
    if (dismissedAt && Date.now() - dismissedAt < 14 * 86400000 && compact) return;
    setHidden(false);
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) { setMode("ios"); return; }
    if (deferred) setMode("button");
    const on = () => setMode("button");
    window.addEventListener("melyos-installable", on);
    return () => window.removeEventListener("melyos-installable", on);
  }, [compact]);

  if (hidden || mode === "none") return null;

  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch {} setHidden(true); };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const r = await deferred.userChoice.catch(() => null);
    deferred = null;
    if (r?.outcome === "accepted") setHidden(true);
  };

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", background: "#fff", border: "1.5px solid #d6e0e6", borderRadius: 12, padding: compact ? "12px 14px" : "16px 18px" }}>
      <div style={{ flex: "0 0 auto", width: 42, height: 42, borderRadius: 10, background: accent, color: "#fff", display: "grid", placeItems: "center" }} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: "#0f2540" }}>Get the {appName} app</div>
        {mode === "button" ? (
          <div style={{ fontSize: 14, color: "#475569" }}>Open your account in one tap from your home screen, with alerts on the icon.</div>
        ) : (
          <div style={{ fontSize: 14, color: "#475569" }}>
            In Safari, tap <b>Share</b>{" "}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: "-2px" }} aria-label="Share icon"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8" /></svg>{" "}
            then <b>Add to Home Screen</b>.
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, flex: "0 0 auto", alignItems: "center" }}>
        {mode === "button" && <button type="button" onClick={install} style={{ background: accent, color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer" }}>Install</button>}
        {compact && <button type="button" onClick={dismiss} aria-label="Not now" style={{ background: "none", border: 0, color: "#94a3b8", fontSize: 22, lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>}
      </div>
    </div>
  );
}
