"use client";

// Oct 19 (per Mely — Aloha rule: golf carts must be insured and driven by a
// licensed driver). Resident portal card to view/add/edit/remove golf carts
// and upload a renewed insurance copy. Inline styles on purpose (Tailwind
// doesn't generate CSS in production on this site).

import { useState } from "react";

type GolfCart = {
  make: string;
  model: string;
  year: string;
  color: string;
  serial_or_tag: string;
  insurance_company: string;
  policy_number: string;
  insurance_expiration: string;
  insurance_doc_path: string;
};

const empty: GolfCart = {
  make: "", model: "", year: "", color: "", serial_or_tag: "",
  insurance_company: "", policy_number: "", insurance_expiration: "", insurance_doc_path: "",
};

const card: React.CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };
const input: React.CSSProperties = { border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" };
const lbl: React.CSSProperties = { fontSize: 12, color: "var(--gray)" };

function expiryStatus(date: string): { text: string; color: string } | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return { text: "Insurance expired — please upload your renewal", color: "#b91c1c" };
  if (days <= 30) return { text: `Insurance expires in ${days + 1} day(s)`, color: "#b45309" };
  return null;
}

export default function GolfCartCard({
  resident,
  maxCarts,
  insuranceRequired,
  onSaved,
}: {
  resident: any;
  maxCarts: number;
  insuranceRequired: boolean;
  onSaved: () => void;
}) {
  const saved: GolfCart[] = Array.isArray(resident?.golf_carts) ? resident.golf_carts : [];
  const [editing, setEditing] = useState(false);
  const [carts, setCarts] = useState<GolfCart[]>([]);
  const [message, setMessage] = useState("");
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  if (maxCarts <= 0 && saved.length === 0) return null;

  function startEdit() {
    setCarts(saved.map((g) => ({ ...empty, ...g })));
    setMessage("");
    setEditing(true);
  }

  async function upload(i: number, file: File) {
    setMessage("");
    if (!(file.type.startsWith("image/") || file.type === "application/pdf")) {
      setMessage("Please upload a photo or a PDF.");
      return;
    }
    setUploadingIdx(i);
    try {
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/portal/golf-carts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          action: "upload",
          fileName: file.name,
          fileDataBase64: base64,
          contentType: file.type,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.path) {
        setMessage("Could not upload the insurance copy: " + (result?.error || res.status));
        return;
      }
      setCarts((prev) => prev.map((g, j) => (j === i ? { ...g, insurance_doc_path: result.path } : g)));
    } catch (e: any) {
      setMessage("Could not upload the insurance copy: " + (e?.message || e));
    } finally {
      setUploadingIdx(null);
    }
  }

  async function save() {
    setMessage("");
    setSaving(true);
    try {
      const res = await fetch("/api/portal/golf-carts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: resident.id, action: "save", golfCarts: carts }),
      });
      const result = await res.json();
      if (!res.ok) {
        setMessage("Could not save: " + (result?.error || res.status));
        return;
      }
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setMessage("Could not save: " + (e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontWeight: 900, fontSize: 18 }}>🛺 Golf Cart</h2>
          <button
            onClick={startEdit}
            style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            {saved.length ? "Edit" : "+ Add"}
          </button>
        </div>
        {saved.length === 0 ? (
          <p style={{ color: "var(--gray)" }}>No golf cart on file.</p>
        ) : (
          saved.map((g, i) => {
            const st = expiryStatus(g.insurance_expiration);
            return (
              <div key={i} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8, fontSize: 14 }}>
                <p style={{ fontWeight: 700 }}>{[g.year, g.make, g.model].filter(Boolean).join(" ")}{g.color ? ` — ${g.color}` : ""}</p>
                {g.serial_or_tag && <p style={{ fontSize: 13 }}>Serial/Tag: {g.serial_or_tag}</p>}
                <p style={{ fontSize: 13 }}>
                  Insurance: {g.insurance_company} · Policy {g.policy_number} · Expires {g.insurance_expiration}
                </p>
                <p style={{ fontSize: 12, color: g.insurance_doc_path ? "#16a34a" : "#b45309" }}>
                  {g.insurance_doc_path ? "Insurance copy on file" : "Insurance copy not uploaded"}
                </p>
                {st && <p style={{ fontSize: 12, color: st.color, fontWeight: 700 }}>{st.text}</p>}
              </div>
            );
          })
        )}
        <p style={{ color: "var(--gray)", fontSize: 12, marginTop: 8 }}>
          Golf carts must be insured and driven only by a person with a valid driver&apos;s license.
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...card, marginTop: 16 }}>
      <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Edit Golf Cart</h2>
      <p style={{ fontSize: 12, color: "var(--gray)", marginBottom: 12 }}>
        Golf carts must be insured and driven only by a person with a valid driver&apos;s license.
        {maxCarts > 0 ? ` Up to ${maxCarts} golf cart(s).` : ""}
      </p>
      {carts.map((g, i) => {
        const update = (patch: Partial<GolfCart>) => setCarts((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
        return (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>Golf Cart {i + 1}</strong>
              <button
                onClick={() => setCarts((prev) => prev.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
            <div><label style={lbl}>Make</label><input style={input} placeholder="e.g. Club Car" value={g.make} onChange={(e) => update({ make: e.target.value })} /></div>
            <div><label style={lbl}>Model</label><input style={input} value={g.model} onChange={(e) => update({ model: e.target.value })} /></div>
            <div><label style={lbl}>Year</label><input style={input} inputMode="numeric" value={g.year} onChange={(e) => update({ year: e.target.value })} /></div>
            <div><label style={lbl}>Color</label><input style={input} value={g.color} onChange={(e) => update({ color: e.target.value })} /></div>
            <div><label style={lbl}>Serial # or tag # (optional)</label><input style={input} value={g.serial_or_tag} onChange={(e) => update({ serial_or_tag: e.target.value })} /></div>
            <div><label style={lbl}>Insurance company</label><input style={input} value={g.insurance_company} onChange={(e) => update({ insurance_company: e.target.value })} /></div>
            <div><label style={lbl}>Policy #</label><input style={input} value={g.policy_number} onChange={(e) => update({ policy_number: e.target.value })} /></div>
            <div><label style={lbl}>Insurance expiration date</label><input type="date" style={input} value={g.insurance_expiration} onChange={(e) => update({ insurance_expiration: e.target.value })} /></div>
            <div>
              <label style={lbl}>Copy of insurance (photo or PDF){insuranceRequired ? "" : " — optional"}</label>
              {g.insurance_doc_path ? (
                <div style={{ fontSize: 13, color: "#16a34a" }}>
                  ✓ On file{" "}
                  <button
                    onClick={() => update({ insurance_doc_path: "" })}
                    style={{ marginLeft: 8, fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Replace
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  style={input}
                  disabled={uploadingIdx === i}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(i, f);
                  }}
                />
              )}
              {uploadingIdx === i && <span style={{ fontSize: 12, color: "var(--gray)" }}>Uploading...</span>}
            </div>
          </div>
        );
      })}
      {carts.length < maxCarts && (
        <button
          onClick={() => setCarts((prev) => [...prev, { ...empty }])}
          style={{ background: "transparent", border: "1.5px dashed var(--border)", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
        >
          + Add a golf cart
        </button>
      )}
      <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 4 }}>The park office is notified whenever you update this information.</p>
      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={save}
          disabled={saving || uploadingIdx !== null}
          style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setMessage(""); }}
          style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
        >
          Cancel
        </button>
        {message && <p style={{ fontSize: 13, color: "#dc2626" }}>{message}</p>}
      </div>
    </div>
  );
}
