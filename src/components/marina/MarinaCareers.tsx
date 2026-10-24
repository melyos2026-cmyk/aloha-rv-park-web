"use client";

import { useState } from "react";

// Oct 23 (per Mely): Careers & Crew application — roles, experience, license upload. The applicant
// pays nothing; if the marina runs background checks, the office starts one from the admin.
export default function MarinaCareers({ title, intro, roles, requireBgc, marina, demo }: { title: string; intro: string; roles: string[]; bgcFee?: number; requireBgc: boolean; marina: string; demo: boolean }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", experience: "", certifications: "", availability: "", hourly_rate: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const input = { width: "100%", padding: 11, borderRadius: 8, border: "1px solid #b8c7d1", fontSize: 15, boxSizing: "border-box" as const };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!picked.length) { setErr("Pick at least one role."); return; }
    if (!consent) { setErr("Please confirm your information and agree to the privacy terms."); return; }
    setBusy(true);
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    fd.append("roles", picked.join(", ")); fd.append("consent", "1");
    if (file) fd.append("license", file);
    const res = await fetch("/api/marina/careers", { method: "POST", body: fd });
    const r = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setErr(r.error || "Could not send your application."); return; }
    setDone(true);
  }

  if (done) return (
    <div className="mr-wrap" style={{ padding: "48px 16px 64px", maxWidth: 560 }}>
      <div className="mr-card" style={{ textAlign: "center", padding: 32 }}>
        <div className="mr-cr-check" aria-hidden>✓</div>
        <h2 className="mr-h2" style={{ marginTop: 12 }}>Application received</h2>
        <p style={{ color: "#4a5a68", lineHeight: 1.6 }}>Thank you for your interest in joining the {marina} crew. Our team will review your experience{requireBgc ? " and may reach out about a background check" : ""}, then contact you by email or phone.</p>
        <a className="mr-btn dark" href="/">Back to {marina}</a>
      </div>
    </div>
  );

  const steps = [
    { n: "1", t: "Tell us about you", d: "Your experience, the roles you can cover and when you're available." },
    { n: "2", t: "Upload your license or ID", d: "A photo or PDF. It is stored privately and seen only by the office." },
    ...(requireBgc ? [{ n: "3", t: "Background check", d: `${marina} covers the cost. If the office moves forward, you'll receive a secure link by email to complete it.` }] : []),
    { n: requireBgc ? "4" : "3", t: "We get in touch", d: "The office reviews everything and contacts you about next steps." },
  ];

  return (
    <div className="mr-cr">
      <section className="mr-cr-hero">
        <div className="mr-wrap" style={{ padding: "48px 16px 40px" }}>
          <div className="mr-cr-kicker">Careers</div>
          <h1 className="mr-h2" style={{ color: "#fff", marginBottom: 8 }}>{title}</h1>
          <p className="mr-lede" style={{ color: "rgba(255,255,255,.85)", marginTop: 0 }}>{intro}</p>
          <div className="mr-cr-roles">{roles.map((r) => <span key={r} className="mr-cr-role">{r}</span>)}</div>
        </div>
      </section>

      <div className="mr-wrap mr-cr-body" style={{ padding: "0 16px 64px" }}>
        <aside className="mr-cr-side">
          <div className="mr-card">
            <h3 style={{ marginTop: 0 }}>How it works</h3>
            <ol className="mr-cr-steps">{steps.map((st) => <li key={st.n}><span className="mr-cr-num">{st.n}</span><div><b>{st.t}</b><div>{st.d}</div></div></li>)}</ol>
          </div>
          <div className="mr-card mr-cr-note">
            <b>Your privacy</b>
            <p style={{ margin: "6px 0 0" }}>Your application is seen only by the {marina} office. Your license is stored privately and never shown publicly.{demo ? " This is a demo marina — nothing is sent to anyone." : ""}</p>
          </div>
        </aside>

        <form onSubmit={submit} className="mr-card mr-cr-form">
          <h3 style={{ marginTop: 0 }}>Apply</h3>
          <div className="mr-cr-section">
            <div className="mr-cr-label">Roles you can do <span>pick all that apply</span></div>
            <div className="mr-seg">{roles.map((r) => <button key={r} type="button" aria-pressed={picked.includes(r)} onClick={() => setPicked(picked.includes(r) ? picked.filter((x) => x !== r) : [...picked, r])}>{r}</button>)}</div>
          </div>
          <div className="mr-cr-section">
            <div className="mr-cr-label">About you</div>
            <label className="mr-fld"><span>Full name (as on your license)</span><input style={input} placeholder="Jane Smith" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
            <div className="mr-fld-row">
              <label className="mr-fld"><span>Email</span><input style={input} type="email" placeholder="you@email.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
              <label className="mr-fld"><span>Phone</span><input style={input} type="tel" placeholder="(555) 555-5555" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            </div>
          </div>
          <div className="mr-cr-section">
            <div className="mr-cr-label">Experience</div>
            <label className="mr-fld"><span>Boats you've run, years, where</span><textarea style={input} rows={4} placeholder="e.g. 8 years running 30–50 ft sportfishers out of Islamorada; charter mate 2 seasons…" value={f.experience} onChange={(e) => setF({ ...f, experience: e.target.value })} /></label>
            <label className="mr-fld"><span>Licenses and certifications</span><input style={input} placeholder="USCG license #, STCW, CPR / First Aid…" value={f.certifications} onChange={(e) => setF({ ...f, certifications: e.target.value })} /></label>
            <div className="mr-fld-row">
              <label className="mr-fld"><span>Availability</span><input style={input} placeholder="Weekends, full time…" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} /></label>
              <label className="mr-fld"><span>Hourly rate ($, optional)</span><input style={input} type="number" inputMode="decimal" placeholder="35" value={f.hourly_rate} onChange={(e) => setF({ ...f, hourly_rate: e.target.value })} /></label>
            </div>
          </div>
          <div className="mr-cr-section">
            <div className="mr-cr-label">License or ID <span>photo or PDF</span></div>
            <label className="mr-file"><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /><span className="mr-btn ghost">Choose file</span><span className="mr-file-name">{file ? file.name : "No file chosen"}</span></label>
          </div>
          <label className="mr-cr-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I confirm the information above is true{requireBgc ? `, I authorize ${marina} to run a background check at its expense if it moves forward with my application` : ""}, and I agree to the <a href="/privacy">Privacy Policy</a>.</span>
          </label>
          {err && <div className="mr-error" role="alert">{err}</div>}
          <button className="mr-btn dark mr-cr-submit" disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
        </form>
      </div>
    </div>
  );
}
