"use client";
import { useEffect, useState } from "react";

// Oct 26 (per Mely): Boater login → Documents. What the marina needs for each boat (insurance,
// registration), what's on file, and a one-minute upload with the phone camera. The office reviews
// every upload; if something is sent back, the reason shows here.
type Need = { type: string; state: "ok" | "expiring" | "pending" | "rejected" | "expired" | "missing"; expires_on: string | null; note: string | null };
type Boat = { id: string; name: string; needs: Need[]; docs: { id: string; type: string; name: string; expires_on: string | null; status: string; note: string | null; at: string }[] };
const LABEL: Record<string, string> = { insurance: "Insurance", registration: "Registration", id: "ID / driver's license", survey: "Survey", other: "Other" };
const STATE: Record<string, [string, string]> = {
  ok: ["On file", "#047857"], expiring: ["Expires soon", "#b45309"], pending: ["Waiting for review", "#0369a1"], rejected: ["Sent back", "#b91c1c"], expired: ["Expired", "#b91c1c"], missing: ["Needed", "#b91c1c"],
};
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");

export default function DocumentsCard() {
  const [boats, setBoats] = useState<Boat[] | null>(null);
  const [form, setForm] = useState<{ boat_id: string; doc_type: string; expires_on: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [bad, setBad] = useState(false);
  const load = () => fetch("/api/marina/documents", { cache: "no-store" }).then((r) => r.json()).then((j) => setBoats(j.boats || [])).catch(() => setBoats([]));
  useEffect(() => { load(); }, []);
  if (!boats || !boats.length) return null;
  const todo = boats.flatMap((b) => b.needs.filter((n) => ["missing", "expired", "rejected", "expiring"].includes(n.state)).map((n) => ({ boat: b, n })));

  async function upload() {
    if (!form || !file) return;
    setBusy(true); setMsg(""); setBad(false);
    const fd = new FormData();
    fd.append("boat_id", form.boat_id); fd.append("doc_type", form.doc_type); fd.append("expires_on", form.expires_on); fd.append("file", file);
    const r = await fetch("/api/marina/documents", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setBad(true); setMsg(j.error || "Could not upload."); return; }
    setForm(null); setFile(null); setBad(j.decision === "rejected"); setMsg(j.message || "Thank you! The office will review it."); load();
  }

  return (
    <div className="mr-card" id="documents" style={todo.length ? { borderColor: "#f59e0b", boxShadow: "0 0 0 2px #fde68a" } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Documents{todo.length ? ` · ${todo.length} needed` : ""}</h3>
        {!form && <button className="mr-btn" onClick={() => setForm({ boat_id: boats[0].id, doc_type: "insurance", expires_on: "" })}>Add a document</button>}
      </div>
      {msg && <div className={bad ? "mr-error" : "mr-ok"} style={{ marginTop: 8 }}>{msg}</div>}
      {todo.length > 0 && !form && (
        <div className="mr-docs-needed">
          {todo.map(({ boat, n }) => (
            <div key={boat.id + n.type} className="mr-inv">
              <div style={{ minWidth: 0 }}>{LABEL[n.type]} · {boat.name}<small>{n.state === "rejected" ? `Sent back: ${n.note}` : n.state === "expiring" ? `Expires ${day(n.expires_on)} — upload the new one` : n.state === "expired" ? "Expired — upload the current one" : "The marina needs this on file"}</small></div>
              <button className="mr-btn dark" style={{ flexShrink: 0 }} onClick={() => setForm({ boat_id: boat.id, doc_type: n.type, expires_on: "" })}>Upload</button>
            </div>
          ))}
        </div>
      )}
      {form && (
        <div className="mr-docs-form">
          <div className="two">
            <label>Boat<select value={form.boat_id} onChange={(e) => setForm({ ...form, boat_id: e.target.value })}>{boats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label>Document<select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })}>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          {(form.doc_type === "insurance" || form.doc_type === "registration") && <label>Expiration date (optional, we read it from the document)<input type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></label>}
          <label className="mr-docs-file">{file ? `✓ ${file.name}` : "Take a photo or choose a file (photo or PDF)"}<input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="mr-btn dark" disabled={busy || !file} onClick={upload}>{busy ? "Checking your document…" : "Send"}</button>
            <button className="mr-btn ghost mr-btn-ink" onClick={() => { setForm(null); setFile(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {boats.map((b) => (
        <div key={b.id} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700 }}>{b.name}</div>
          <div className="mr-docs-chips">
            {b.needs.map((n) => <span key={n.type} style={{ borderColor: STATE[n.state][1], color: STATE[n.state][1] }}>{LABEL[n.type]}: {STATE[n.state][0]}{n.expires_on && (n.state === "ok" || n.state === "expiring") ? ` · until ${day(n.expires_on)}` : ""}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}
