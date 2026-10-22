"use client";

import { useEffect, useState } from "react";

// Oct 22 (per Mely): the boater's own Marketplace items, inside Boater login. Post, edit, add
// photos, mark sold, repost or delete. Mely reviews each item before it is published.
type L = { id: string; title: string; description: string | null; price: number | null; category: string | null; status: string; expires_at: string | null; photos: string[] };
const money = (n: number | null) => (n == null ? "Free / make an offer" : n === 0 ? "Free" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const blank = { title: "", description: "", price: "", category: "Other" };

export default function MarketplaceCard() {
  const [list, setList] = useState<L[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [ready, setReady] = useState(true);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/marina/marketplace?mine=1", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    setList(r.listings || []); setCats(r.categories || []); setReady(r.ready !== false);
  }
  useEffect(() => { load(); }, []);

  async function act(action: string, listingId: string) {
    setErr(""); setOk("");
    const res = await fetch("/api/marina/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, listingId }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(r.error || "Could not update."); return; }
    load();
  }

  async function save() {
    if (!form) return;
    setBusy(true); setErr(""); setOk("");
    const res = await fetch("/api/marina/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", listingId: editing, ...form }) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setErr(r.error || "Could not save."); return; }
    for (const f of files.slice(0, 8)) {
      const fd = new FormData(); fd.append("listingId", r.listingId); fd.append("file", f);
      const pr = await fetch("/api/marina/marketplace", { method: "POST", body: fd });
      if (!pr.ok) { const pj = await pr.json().catch(() => ({})); setErr(pj.error || "A photo could not be added."); }
    }
    setBusy(false); setForm(null); setEditing(null); setFiles([]);
    setOk(editing ? "Your item was updated." : "Your item is now on the Marketplace.");
    load();
  }

  const input = { width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };
  return (
    <div className="mr-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Marketplace</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="mr-btn ghost" href="/marina/marketplace">See all items</a>
          {!form && ready && <button className="mr-btn" onClick={() => { setForm({ ...blank }); setEditing(null); setFiles([]); setErr(""); setOk(""); }}>Sell an item</button>}
        </div>
      </div>
      {!ready && <p className="mr-note" style={{ marginTop: 8 }}>The Marketplace is coming soon.</p>}
      {ok && <div className="mr-ok" role="status" style={{ marginTop: 10 }}>{ok}</div>}
      {err && <div className="mr-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}

      {form && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input style={input} placeholder="What are you selling? (e.g. Garmin fish finder)" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input style={input} type="number" inputMode="decimal" min="0" placeholder="Price ($)" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <select style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {cats.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <textarea style={input} rows={3} placeholder="Condition, size, pickup details…" value={form.description} maxLength={3000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="mr-note" style={{ margin: 0 }}>
            Photos (up to 8){" "}
            <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 8))} />
          </label>
          <p className="mr-note" style={{ margin: 0 }}>Mely reviews each item before it is published. Only personal items for sale; no weapons, alcohol, pets, services or business ads. Buyers write to you by email; your phone and email are never shown.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="mr-btn ghost" disabled={busy} onClick={() => { setForm(null); setEditing(null); }}>Cancel</button>
            <button className="mr-btn dark" disabled={busy || !form.title.trim()} onClick={save}>{busy ? "Mely is reviewing…" : editing ? "Save changes" : "Publish"}</button>
          </div>
        </div>
      )}

      {!form && list.length === 0 && ready && <p className="mr-note" style={{ marginTop: 8 }}>Sell gear you no longer use to other boaters at the marina.</p>}
      {!form && list.map((l) => {
        const expired = l.status === "active" && l.expires_at && new Date(l.expires_at) < new Date();
        return (
          <div key={l.id} className="mr-inv mr-mkt-row">
            <div className="mr-mkt-info" style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {l.photos[0] ? <img src={l.photos[0]} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} /> : null}
              <div style={{ minWidth: 0 }}>
                {l.title}
                <small>{money(l.price)} · {l.status === "sold" ? "Sold" : expired ? "Expired" : "Active"}</small>
              </div>
            </div>
            <div className="mr-mkt-actions">
              {l.status === "active" && !expired && <button className="mr-btn ghost" onClick={() => { setEditing(l.id); setForm({ title: l.title, description: l.description || "", price: l.price == null ? "" : String(l.price), category: l.category || "Other" }); setFiles([]); }}>Edit</button>}
              {l.status === "active" && !expired && <button className="mr-btn ghost" onClick={() => act("sold", l.id)}>Sold</button>}
              {(l.status === "sold" || expired) && <button className="mr-btn ghost" onClick={() => act("repost", l.id)}>Repost</button>}
              <button className="mr-btn ghost" onClick={() => { if (confirmDel === l.id) { setConfirmDel(null); act("delete", l.id); } else setConfirmDel(l.id); }}>{confirmDel === l.id ? "Tap again to delete" : "Delete"}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
