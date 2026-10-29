"use client";

import { useEffect, useState } from "react";
import ContractText from "@/components/marina/ContractText";
import { styledSignature } from "@/components/marina/ContractsCard";
import { usePortalLang, ptr, translateServerMessage, getPortalLang } from "@/lib/portalI18n";

// Oct 28 (per Mely): Lease Addenda — the park sends residents who signed a PAPER lease an addendum
// (first one: "Lease Addendum — Returned Payments"). While one is waiting, this card sits at the top
// of the dashboard; the resident reads it, checks "I have read and agree", types their full name
// (adopted signature, same as the marina contracts) and signs. API: /api/portal/lease-addenda.
// Inline styles on purpose (Tailwind doesn't generate CSS in production on this site).

export type PortalAddendum = {
  id: string; title: string; body: string; body_sha256: string; status: "pending" | "signed";
  effective_date: string | null; lot_name: string | null; sent_at: string; last_sent_at: string | null;
  sent_by_name: string | null; sent_by_title: string | null; sent_by_signature: string | null;
  viewed_at: string | null; signed_at: string | null; signer_name: string | null; signature_image: string | null; hasPdf: boolean;
};

const FONT = { font: "Great Vibes", size: 62 };

export async function fetchLeaseAddenda(residentId: string): Promise<{ addenda: PortalAddendum[]; fullName: string; landlord: string }> {
  const r = await fetch(`/api/portal/lease-addenda?residentId=${encodeURIComponent(residentId)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
  return { addenda: Array.isArray(r.addenda) ? r.addenda : [], fullName: r.fullName || "", landlord: r.landlord || "" };
}

export async function openSignedAddendum(residentId: string, id: string) {
  const w = window.open("", "_blank");
  const r = await fetch(`/api/portal/lease-addenda?residentId=${encodeURIComponent(residentId)}&pdf=${encodeURIComponent(id)}`).then((x) => x.json()).catch(() => ({}));
  if (r.url) { if (w) w.location.href = r.url; else window.location.href = r.url; }
  else { w?.close(); window.alert(translateServerMessage(getPortalLang(), r.error) || ptr("Could not open the signed copy.")); }
}

export default function LeaseAddendaCard({ residentId, fullName, parkName, landlord, addenda, onChanged }: {
  residentId: string; fullName: string; parkName: string; landlord: string; addenda: PortalAddendum[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState<PortalAddendum | null>(null);
  const { lang, t, err: serverMsg, rich, date } = usePortalLang();
  const day = (d: string | null) => (d ? date(d, { month: "long", day: "numeric", year: "numeric" }) : "");
  // Oct 28 (per Mely — phone): while the addendum is open, the page behind doesn't scroll, so the whole
  // document, the signature and the Sign button scroll inside the dialog, above the bottom menu.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ message: string; id: string; hasPdf: boolean } | null>(null);
  const pending = addenda.filter((a) => a.status === "pending");

  // Arriving from the email (#lease-addendum) opens the first one straight away.
  // (Also when "Needs your attention" → "Please sign" sets that hash while the page is open.)
  useEffect(() => {
    const go = () => { if (window.location.hash === "#lease-addendum" && pending[0]) show(pending[0]); };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length]);

  // Closing clears #lease-addendum (no hashchange fires), so "Please sign" can open it again.
  function close() {
    setOpen(null);
    if (window.location.hash === "#lease-addendum") history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  function show(a: PortalAddendum) {
    setOpen(a); setName(""); setAgree(false); setErr("");
    if (!a.viewed_at) fetch("/api/portal/lease-addenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId, id: a.id, action: "view" }) }).catch(() => {});
  }
  async function sign() {
    if (!open) return;
    setBusy(true); setErr("");
    const adopted = await styledSignature(name.trim(), FONT.font, FONT.size);
    const res = await fetch("/api/portal/lease-addenda", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, id: open.id, action: "sign", name, agree, bodySha256: open.body_sha256, signature: adopted, signature_style: FONT.font }),
    });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(serverMsg(r.error) || t("Could not sign. Please try again.")); if (res.status === 409) onChanged(); return; }
    setDone({ message: r.message ? serverMsg(r.message) : t("Signed. Thank you!"), id: open.id, hasPdf: !!r.hasPdf });
    close();
    onChanged();
  }

  if (!pending.length && !done) return null;

  const btn: React.CSSProperties = { background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "12px 22px", fontWeight: 700, cursor: "pointer", fontSize: 15 };
  const ghost: React.CSSProperties = { background: "transparent", border: "1.5px solid #000", color: "#000", borderRadius: 6, padding: "10px 18px", fontWeight: 700, cursor: "pointer" };

  return (
    <div id="lease-addendum" className="rp-anchor">
      {done && (
        <div role="status" style={{ background: "var(--mint, #ecfdf5)", border: "1.5px solid #86efac", color: "var(--green, #14532d)", borderRadius: 8, padding: "14px 18px", fontWeight: 600, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: pending.length ? 12 : 0 }}>
          <span>✓ {done.message}</span>
          {done.hasPdf && <button type="button" style={ghost} onClick={() => openSignedAddendum(residentId, done.id)}>{t("Download signed copy")}</button>}
        </div>
      )}
      {pending.map((a) => (
        <div key={a.id} style={{ background: "#fff", border: "2px solid #f59e0b", boxShadow: "0 0 0 3px #fde68a", borderRadius: 10, padding: "20px 22px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#b45309" }}>{t("Action needed")}</div>
            <h2 style={{ fontWeight: 900, fontSize: 19, margin: "4px 0 6px" }}>{t("Please review and sign: {title}", { title: a.title })}</h2>
            <p style={{ color: "#4b5563", fontSize: 14, margin: 0 }}>
              {t("{park} sent you a short agreement that puts in writing the park's rule for returned payments{lot}. Everything else about your rental stays the same. Sent {date}.", { park: parkName, lot: a.lot_name ? t(" for Lot {name}", { name: a.lot_name }) : "", date: day(a.last_sent_at || a.sent_at) })}
            </p>
            {lang !== "en" && <p style={{ color: "#4b5563", fontSize: 12.5, fontStyle: "italic", margin: "6px 0 0" }}>{t("This document is in English; it is the version you sign.")}</p>}
          </div>
          <button type="button" style={btn} onClick={() => show(a)}>{t("Review and sign")}</button>
        </div>
      ))}

      {open && (
        <div role="dialog" aria-modal="true" aria-label={open.title} style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.5)", overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px 12px calc(24px + env(safe-area-inset-bottom))" }} onClick={close}>
          <div style={{ background: "#fff", color: "#111827", borderRadius: 12, maxWidth: 760, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", padding: 18, gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>{open.title}</h3>
              <button type="button" aria-label={t("Close")} onClick={close} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer", color: "#6b7280" }}>×</button>
            </div>
            {lang !== "en" && (
              <p style={{ margin: 0, fontSize: 13.5, background: "#fffbeb", border: "1px solid #fcd34d", color: "#78350f", borderRadius: 8, padding: "8px 12px" }}>
                {t("This document is in English; it is the version you sign.")}
              </p>
            )}
            {/* The signed text is hashed (body_sha256) — it is always shown exactly as sent, in English. */}
            <div lang="en" style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: "20px 22px", background: "#fff" }}>
              <ContractText body={open.body} owner={fullName} marina={landlord || parkName} sentBy={open.sent_by_name} sentAt={open.sent_at}
                sentBySignature={open.sent_by_signature} sentByTitle={open.sent_by_title} labels={{ owner: "RESIDENT", company: "PARK" }} />
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
                <span>{rich("<b>I have read and agree</b> to this Resident Agreement, and I adopt the signature below and agree to sign electronically.")}</span>
              </label>
              <label style={{ fontSize: 14, fontWeight: 600 }}>{t("Type your full name to sign")}
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={fullName} autoComplete="name"
                  style={{ display: "block", width: "100%", padding: "10px 12px", marginTop: 4, border: "1px solid #9ca3af", borderRadius: 8, fontSize: 16, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
              </label>
              <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" />
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Your signature")}</div>
              <div style={{ background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 16px", minHeight: 78, display: "flex", alignItems: "center", overflow: "hidden" }}>
                <span style={{ fontFamily: `"${FONT.font}", cursive`, fontSize: 40, color: "#0f2540", whiteSpace: "nowrap" }}>{name.trim() || fullName}</span>
              </div>
              <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#6b7280", margin: 0 }}>
                {rich("By checking the box and pressing <b>Sign agreement</b>, I agree that the signature shown above, together with my typed name, is my electronic signature on this agreement, the same as a pen-and-paper signature. I consent to receive this agreement and related notices electronically, and I understand I can download a signed copy from Documents. My name, the date and time, my IP address and device are recorded with my signature.")}
              </p>
              {err && <div role="alert" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}>{err}</div>}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" style={ghost} onClick={close}>{t("Not now")}</button>
                <button type="button" style={{ ...btn, opacity: busy || !agree || !name.trim() ? 0.5 : 1, cursor: busy || !agree || !name.trim() ? "not-allowed" : "pointer" }} disabled={busy || !agree || !name.trim()} onClick={sign}>{busy ? t("Signing…") : t("Sign agreement")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
