"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Oct 26 (per Mely): documents sent with a slip request (no boat on file yet). Photo or PDF from
// the phone; the office reviews each one.
const LABEL: Record<string, string> = { insurance: "Insurance", registration: "Registration", id: "ID / driver's license", survey: "Survey", other: "Other" };
const STATE: Record<string, [string, string]> = { pending: ["Waiting for review", "#0369a1"], approved: ["Approved", "#047857"], rejected: ["Sent back", "#b91c1c"] };
type Doc = { id: string; doc_type: string; status: string; review_note: string | null };

export default function RequestDocs({ number, t, docs, need }: { number: string; t: string; docs: Doc[]; need: string[] }) {
  const router = useRouter();
  const [type, setType] = useState(need.find((n) => !docs.some((d) => d.doc_type === n && d.status !== "rejected")) || "insurance");
  const [exp, setExp] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const missing = need.filter((n) => !docs.some((d) => d.doc_type === n && d.status !== "rejected"));

  async function upload() {
    if (!file) return;
    setBusy(true); setErr(""); setMsg("");
    const fd = new FormData();
    fd.append("number", number); fd.append("t", t); fd.append("doc_type", type); fd.append("expires_on", exp); fd.append("file", file);
    const r = await fetch("/api/marina/slip-request/documents", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || "Could not upload."); return; }
    setFile(null); setExp("");
    if (j.decision === "rejected") setErr(j.message); else setMsg(j.message || "Thank you! The office will review it.");
    router.refresh();
  }

  return (
    <div>
      <p style={{ margin: "6px 0 10px" }}>{missing.length ? `The marina needs: ${missing.map((m) => LABEL[m]).join(", ")}. Send them now to save time.` : "Thank you, the marina has what it needs. You can add more below."}</p>
      {docs.length > 0 && (
        <div className="mr-docs-chips" style={{ marginBottom: 10 }}>
          {docs.map((d) => <span key={d.id} style={{ borderColor: STATE[d.status]?.[1], color: STATE[d.status]?.[1] }}>{LABEL[d.doc_type] || d.doc_type}: {STATE[d.status]?.[0] || d.status}{d.status === "rejected" && d.review_note ? ` (${d.review_note})` : ""}</span>)}
        </div>
      )}
      <div className="mr-docs-form">
        <label>Document<select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {(type === "insurance" || type === "registration") && <label>Expiration date (optional, we read it from the document)<input type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>}
        <label className="mr-docs-file">{file ? `✓ ${file.name}` : "Take a photo or choose a file (photo or PDF)"}<input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        <button type="button" className="mr-btn dark" disabled={busy || !file} onClick={upload}>{busy ? "Checking your document…" : "Send"}</button>
      </div>
      {msg && <div className="mr-ok" style={{ marginTop: 8 }}>{msg}</div>}
      {err && <div className="mr-error" role="alert" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
