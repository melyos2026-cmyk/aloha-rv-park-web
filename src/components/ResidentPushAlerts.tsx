"use client";

import { useEffect, useState } from "react";

// Oct 9 (per Mely): "Turn on alerts" for the installed Resident Portal app.
// Needs a tap (iPhone/iPad require a user gesture); on iPhone/iPad the app
// must be added to the Home Screen first.
function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(Array.from(raw).map((c) => c.charCodeAt(0)));
}

export default function ResidentPushAlerts({ residentId }: { residentId: string | null }) {
  const [state, setState] = useState<"checking" | "unsupported" | "off" | "on" | "blocked" | "ios-install">("checking");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
        const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
        if (isIOS && !standalone) return setState("ios-install");
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
        if (Notification.permission === "denied") return setState("blocked");
        const reg = await navigator.serviceWorker.getRegistration("/residents");
        const sub = await reg?.pushManager.getSubscription();
        setState(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function enable() {
    if (!residentId) return;
    setBusy(true);
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/residents")) || (await navigator.serviceWorker.ready);
      const { publicKey } = await (await fetch("/api/portal/push-key")).json();
      if (!publicKey) throw new Error("Alerts are not ready yet.");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await fetch("/api/portal/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save.");
      setState("on");
      setMsg("Alerts are on for this device.");
    } catch (e: any) {
      setMsg(e?.message || "Could not turn on alerts.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/residents");
      const sub = await reg?.pushManager.getSubscription();
      if (sub && residentId) {
        await fetch("/api/portal/push-subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ residentId, endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking" || state === "unsupported") return null;
  const txt: React.CSSProperties = { fontSize: 12, color: "#000", marginTop: 8 };
  if (state === "ios-install")
    return <p style={txt}>📲 To get alerts on iPhone/iPad: tap Share → "Add to Home Screen", then open the app from your Home Screen.</p>;
  if (state === "blocked")
    return <p style={txt}>🔕 Alerts are blocked for this app. Turn them on in your device or browser settings.</p>;

  return (
    <div style={txt}>
      {state === "on" ? (
        <button onClick={disable} disabled={busy} style={{ background: "none", border: "none", color: "#374151", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0 }}>
          🔔 Alerts on — turn off on this device
        </button>
      ) : (
        <button
          onClick={enable}
          disabled={busy || !residentId}
          style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 700, cursor: "pointer", fontSize: 12 }}
        >
          {busy ? "Turning on…" : "🔔 Turn on alerts on this device"}
        </button>
      )}
      {msg && <p style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
