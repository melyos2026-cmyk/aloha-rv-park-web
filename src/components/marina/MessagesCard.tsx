"use client";

import { useEffect, useState } from "react";

// Oct 21 (per Mely): messages from the marina office, and the boater's replies.
type M = { id: string; direction: "office" | "boater"; subject: string | null; body: string; sent_by_name: string | null; read_at: string | null; created_at: string };
const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function MessagesCard({ startOpen = false }: { startOpen?: boolean } = {}) {
  const [list, setList] = useState<M[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load(markRead = false) {
    const r = await fetch(`/api/marina/messages${markRead ? "?read=1" : ""}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    setList(r.messages || []); setUnread(markRead ? 0 : r.unread || 0);
  }
  useEffect(() => { load(startOpen); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function send() {
    setBusy(true); setErr("");
    const res = await fetch("/api/marina/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(r.error || "Could not send."); return; }
    setText(""); load(true);
  }

  const latest = list[list.length - 1];
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Messages {unread > 0 && <span style={{ background: "#d97706", color: "#fff", borderRadius: 999, padding: "1px 9px", fontSize: 13, marginLeft: 6, verticalAlign: "middle" }}>{unread} new</span>}</h3>
        <button className="mr-btn ghost" onClick={() => { const o = !open; setOpen(o); if (o) load(true); }}>{open ? "Close" : list.length ? "Open" : "Write to the office"}</button>
      </div>
      {!open && latest && <p className="mr-note" style={{ marginTop: 8 }}>{latest.direction === "office" ? (latest.subject ? `${latest.subject}: ` : "") : "You: "}{latest.body.slice(0, 140)}{latest.body.length > 140 ? "…" : ""}</p>}
      {!open && !latest && <p className="mr-note" style={{ marginTop: 8 }}>Notices from the marina office appear here. You can also write to the office.</p>}
      {open && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
            {list.map((m) => (
              <div key={m.id} style={{ justifySelf: m.direction === "boater" ? "end" : "start", maxWidth: "88%", background: m.direction === "boater" ? "#0f2540" : "#eef3f6", color: m.direction === "boater" ? "#fff" : "#0f2540", borderRadius: 10, padding: "8px 12px" }}>
                {m.direction === "office" && m.subject && <div style={{ fontWeight: 700, marginBottom: 2 }}>{m.subject}</div>}
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{m.body}</div>
                <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 3 }}>{when(m.created_at)}{m.direction === "office" ? " · Marina office" : ""}</div>
              </div>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write to the marina office…" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15 }} />
          {err && <div className="mr-error" role="alert">{err}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="mr-note" style={{ margin: 0 }}>Only the marina office sees your messages.</span>
            <button className="mr-btn dark" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
