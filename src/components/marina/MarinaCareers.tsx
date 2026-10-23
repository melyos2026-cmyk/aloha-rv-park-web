"use client";

import { useEffect, useState } from "react";

// Oct 23 (per Mely): Careers & Crew application. Same path as the RV-park application:
// register → license → pay your own background check → the office approves.
export default function MarinaCareers({ title, intro, roles, bgcFee, requireBgc, marina, demo }: { title: string; intro: string; roles: string[]; bgcFee: number; requireBgc: boolean; marina: string; demo: boolean }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", experience: "", certifications: "", availability: "", hourly_rate: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<null | { demo?: boolean; paid?: boolean }>(null);
  useEffect(() => { const u = new URLSearchParams(window.location.search); if (u.get("paid") === "1") setDone({ paid: true }); }, []);
  const input = { width: "100%", padding: 11, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!picked.length) { setErr("Pick at least one role."); return; }
    if (!consent) { setErr("Please agree to the background check and privacy terms."); return; }
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    fd.append("roles", picked.join(", ")); fd.append("consent", "1");
    if (file) fd.append("license", file);
    const res = await fetch("/api/marina/careers", { method: "POST", body: fd });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(r.error || "Could not send your application."); return; }
    if (r.url) { window.location.href = r.url; return; }
    setDone({ demo: !!r.demo });
  }

  if (done) return (
    <div className="mr-wrap" style={{ padding: "40px 16px 60px", maxWidth: 640 }}>
      <div className="mr-card" style={{ textAlign: "center" }}>
        <h2 className="mr-h2">Thank you!</h2>
        <p>{done.paid ? "Your payment was received. Check your email for the background check link — complete it and the office will review your application." : done.demo ? "Demo: your application is in and the background check is marked as in progress (no card was charged)." : "Your application is in. The office will review it and get back to you."}</p>
        <a className="mr-btn dark" href="/">Back to {marina}</a>
      </div>
    </div>
  );

  return (
    <div className="mr-wrap" style={{ padding: "28px 16px 56px", maxWidth: 720 }}>
      <h1 className="mr-h2" style={{ marginBottom: 4 }}>{title}</h1>
      <p className="mr-lede" style={{ marginTop: 0 }}>{intro}</p>
      <div className="mr-card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>How it works</h3>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Tell us about yourself and upload your license or ID.</li>
          {requireBgc && <li>Pay your background check (${bgcFee.toFixed(2)}{demo ? ", simulated in this demo" : ""}) — you'll get a secure link by email to complete it.</li>}
          <li>The office reviews everything and contacts you.</li>
        </ol>
      </div>
      <form onSubmit={submit} className="mr-card" style={{ display: "grid", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Roles you can do</div>
          <div className="mr-seg">{roles.map((r) => <button key={r} type="button" aria-pressed={picked.includes(r)} onClick={() => setPicked(picked.includes(r) ? picked.filter((x) => x !== r) : [...picked, r])}>{r}</button>)}</div>
        </div>
        <label className="mr-fld"><span>Full name (as on your license)</span><input style={input} placeholder="Jane Smith" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        <div className="mr-fld-row">
          <label className="mr-fld"><span>Email</span><input style={input} type="email" placeholder="you@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label className="mr-fld"><span>Phone</span><input style={input} type="tel" placeholder="(555) 555-5555" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        </div>
        <label className="mr-fld"><span>Experience</span><textarea style={input} rows={3} placeholder="Boats you've run, years, where" value={f.experience} onChange={(e) => setF({ ...f, experience: e.target.value })} /></label>
        <label className="mr-fld"><span>Licenses and certifications</span><input style={input} placeholder="USCG license #, STCW, CPR…" value={f.certifications} onChange={(e) => setF({ ...f, certifications: e.target.value })} /></label>
        <div className="mr-fld-row">
          <label className="mr-fld"><span>Availability</span><input style={input} placeholder="Weekends, full time…" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} /></label>
          <label className="mr-fld"><span>Hourly rate ($, optional)</span><input style={input} type="number" inputMode="decimal" placeholder="35" value={f.hourly_rate} onChange={(e) => setF({ ...f, hourly_rate: e.target.value })} /></label>
        </div>
        <div className="mr-fld"><span>License or ID (photo or PDF)</span>
          <label className="mr-file"><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /><span className="mr-btn ghost">Choose file</span><span className="mr-file-name">{file ? file.name : "No file chosen"}</span></label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, paddingRight: 72 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I authorize {marina} to run a background check{requireBgc ? ` that I pay for ($${bgcFee.toFixed(2)})` : ""}, I confirm the information above is true, and I agree to the <a href="/privacy">Privacy Policy</a>.</span>
        </label>
        {err && <div className="mr-error" role="alert">{err}</div>}
        <button className="mr-btn dark" disabled={busy}>{busy ? "Sending…" : requireBgc ? "Send application and pay background check" : "Send application"}</button>
      </form>
    </div>
  );
}
