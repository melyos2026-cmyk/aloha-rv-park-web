"use client";

import { useEffect, useRef, useState } from "react";

// Oct 21 (per Mely): contracts the marina sent to this boater, read and signed online.
type K = { id: string; title: string; body: string; status: string; sent_at: string; signed_at: string | null; signer_name: string | null; start_date: string | null; end_date: string | null; hasPdf: boolean };
const day = (d: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const used = useRef(false);
  useEffect(() => {
    const c = ref.current!; const r = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * r; c.height = c.offsetHeight * r;
    const g = c.getContext("2d")!; g.scale(r, r); g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0f2540";
  }, []);
  const pos = (e: React.PointerEvent) => { const b = ref.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  return (
    <div>
      <canvas
        ref={ref}
        style={{ width: "100%", height: 120, border: "1.5px dashed #9fb3c0", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const p = pos(e); const g = ref.current!.getContext("2d")!; g.beginPath(); g.moveTo(p.x, p.y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const p = pos(e); const g = ref.current!.getContext("2d")!; g.lineTo(p.x, p.y); g.stroke(); used.current = true; }}
        onPointerUp={() => { drawing.current = false; if (used.current) onChange(ref.current!.toDataURL("image/png")); }}
      />
      <button type="button" className="mr-btn ghost" style={{ marginTop: 6, minHeight: 32, padding: "0 12px" }} onClick={() => {
        const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); used.current = false; onChange(null);
      }}>Clear</button>
    </div>
  );
}

export default function ContractsCard({ fullName }: { fullName: string }) {
  const [list, setList] = useState<K[]>([]);
  const [open, setOpen] = useState<K | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  async function load() {
    const r = await fetch("/api/marina/contracts", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    setList(r.contracts || []);
  }
  useEffect(() => { load(); }, []);

  function show(k: K) {
    setOpen(k); setName(""); setAgree(false); setSig(null); setErr("");
    if (k.status === "sent") fetch("/api/marina/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: k.id, action: "view" }) }).catch(() => {});
  }
  async function sign() {
    if (!open) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/marina/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: open.id, action: "sign", name, agree, signature: sig }) });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(r.error || "Could not sign. Please try again."); return; }
    setOpen(null); setDone("Signed. Thank you! Your copy is ready to download."); load();
  }
  async function pdf(id: string) {
    const w = window.open("", "_blank");
    const r = await fetch(`/api/marina/contracts?pdf=${id}`).then((x) => x.json()).catch(() => ({}));
    if (r.url) { if (w) w.location.href = r.url; else window.location.href = r.url; } else w?.close();
  }

  if (!list.length) return null;
  const waiting = list.filter((k) => k.status !== "signed");
  return (
    <div className="mr-card">
      <h3>{waiting.length ? "Contracts to sign" : "My contracts"}</h3>
      {done && <div className="mr-ok" role="status">{done}</div>}
      {list.map((k) => (
        <div className="mr-inv" key={k.id}>
          <div>{k.title}<small>{k.status === "signed" ? `Signed ${day(k.signed_at)}` : `Sent ${day(k.sent_at)}`}{k.start_date ? ` · ${day(k.start_date)} – ${day(k.end_date)}` : ""}</small></div>
          {k.status === "signed"
            ? (k.hasPdf ? <button className="mr-btn ghost" onClick={() => pdf(k.id)}>Download PDF</button> : <span className="mr-note">Signed</span>)
            : <button className="mr-btn" onClick={() => show(k)}>Read and sign</button>}
        </div>
      ))}

      {open && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(6,20,32,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={() => setOpen(null)}>
          <div style={{ background: "#fff", color: "#0f2540", borderRadius: 12, maxWidth: 760, width: "100%", maxHeight: "94vh", display: "flex", flexDirection: "column", padding: 18, gap: 12 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem" }}>{open.title}</h3>
              <button type="button" aria-label="Close" onClick={() => setOpen(null)} style={{ background: "none", border: 0, fontSize: 26, lineHeight: 1, cursor: "pointer", color: "#5b6b78" }}>×</button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, minHeight: 160, border: "1px solid #dbe3e8", borderRadius: 8, padding: "14px 16px", whiteSpace: "pre-wrap", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, lineHeight: 1.6 }}>{open.body}</div>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ fontSize: 14, fontWeight: 600 }}>Type your full name to sign
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={fullName} autoComplete="name"
                  style={{ display: "block", width: "100%", padding: "10px 12px", marginTop: 4, border: "1px solid #b8c7d1", borderRadius: 8, fontSize: 16, fontFamily: "Georgia, serif" }} />
              </label>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Draw your signature (optional)</div>
              <SignaturePad onChange={setSig} />
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
                <span>I agree to sign this contract electronically. My typed name is my signature and has the same effect as signing on paper.</span>
              </label>
              {err && <div className="mr-error" role="alert">{err}</div>}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button type="button" className="mr-btn ghost" onClick={() => setOpen(null)}>Not now</button>
                <button type="button" className="mr-btn dark" disabled={busy || !agree || !name.trim()} onClick={sign}>{busy ? "Signing…" : "Sign contract"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
