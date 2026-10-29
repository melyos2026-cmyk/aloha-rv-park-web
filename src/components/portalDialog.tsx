"use client";

// Oct 19 (per Mely — the browser's own "aloharvparkfl.com says" pop-up
// looked out of place): styled confirm/alert dialogs for the resident
// portal. Promise-based so call sites read like the native ones:
//   if (!(await portalConfirm("Remove this person?"))) return;
//   await portalAlert("Saved.");
// Mounts its own small React root on demand, so no provider is needed.
// Inline styles on purpose (Tailwind doesn't generate CSS in production on
// this site).

import React, { useEffect, useRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { translate, getPortalLang } from "@/lib/portalI18n";

// Oct 29 (i18n): default title/buttons follow the resident portal language only on portal pages —
// the public pages that also use these dialogs (lease application, inquiries) stay in English.
const PORTAL_PATHS = /^\/(residents|login|portal|pay-invoice|electric-history)(\/|$)/;
function ptr(key: string) {
  const onPortal = typeof window !== "undefined" && PORTAL_PATHS.test(window.location.pathname);
  return translate(onPortal ? getPortalLang() : "en", key);
}

type Opts = { title?: string; confirmText?: string; cancelText?: string; danger?: boolean };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function ensureRoot(): Root {
  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-portal-dialog", "");
    document.body.appendChild(host);
  }
  if (!root) root = createRoot(host);
  return root;
}

function Dialog({
  message,
  opts,
  showCancel,
  onClose,
}: {
  message: string;
  opts: Opts;
  showCancel: boolean;
  onClose: (ok: boolean) => void;
}) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={() => onClose(false)}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 10000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, maxWidth: 420, width: "100%",
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)", padding: "22px 22px 18px",
          fontFamily: "inherit", color: "#111",
        }}
      >
        <h3 style={{ fontWeight: 900, fontSize: 18, margin: "0 0 8px" }}>
          {opts.title || ptr(showCancel ? "Please confirm" : "Notice")}
        </h3>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#374151", margin: "0 0 18px", whiteSpace: "pre-wrap" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {showCancel && (
            <button
              onClick={() => onClose(false)}
              style={{
                background: "transparent", border: "1.5px solid #d1d5db", borderRadius: 6,
                padding: "9px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", color: "#111",
              }}
            >
              {opts.cancelText || ptr("Cancel")}
            </button>
          )}
          <button
            ref={okRef}
            onClick={() => onClose(true)}
            style={{
              background: opts.danger ? "#b91c1c" : "#000", color: "#fff", border: "none", borderRadius: 6,
              padding: "9px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}
          >
            {opts.confirmText || ptr(showCancel ? "Yes" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}

function open(message: string, opts: Opts, showCancel: boolean): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const r = ensureRoot();
    const close = (ok: boolean) => {
      r.render(<></>);
      resolve(ok);
    };
    r.render(<Dialog message={message} opts={opts} showCancel={showCancel} onClose={close} />);
  });
}

export function portalConfirm(message: string, opts: Opts = {}): Promise<boolean> {
  return open(message, opts, true);
}

export function portalAlert(message: string, opts: Opts = {}): Promise<void> {
  return open(message, opts, false).then(() => undefined);
}
