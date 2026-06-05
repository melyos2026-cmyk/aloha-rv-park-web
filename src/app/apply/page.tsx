"use client";
import { useState } from "react";

export default function ApplyPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    currentAddress: "", city: "", state: "", zip: "",
    rvMa
cat > src/app/apply/page.tsx << 'EOF'
"use client";
import { useState } from "react";

export default function ApplyPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    currentAddress: "", city: "", state: "", zip: "",
    rvMake: "", rvModel: "", rvYear: "", rvLength: "",
    adults: "", children: "", pets: "", petDescription: "",
    stayType: "monthly", arrivalDate: "", emergencyName: "", emergencyPhone: "",
    agreeRules: false, agreeBackground: false
  });

  const update = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--black)", color: "var(--white)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Join Our Community</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Apply to Aloha RV Park</h1>
        <p style={{ fontSize: 16, color: "#9ca3af", maxWidth: 500, margin: "0 auto" }}>
          Complete your application online. A background check is required for all new residents.
        </p>
      </section>

      {/* Steps indicator */}
      <section style={{ background: "var(--white)", borderBottom: "2px solid var(--black)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", justifyContent: "center", gap: 0 }}>
          {["Personal Info","RV Info","Stay Details","Review"].map((s,i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", position: "relative" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", margin: "0 auto 6px",
                background: step > i+1 ? "var(--green)" : step === i+1 ? "var(--black)" : "var(--gray-light)",
                color: step >= i+1 ? "var(--white)" : "var(--gray)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 13
              }}>
                {step > i+1 ? "✓" : i+1}
              </div>
              <div style={{ fontSize: 11, color: step >= i+1 ? "var(--black)" : "var(--gray)", fontWeight: step === i+1 ? 700 : 400 }}>{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Form */}
      <section style={{ padding: "60px 24px", background: "var(--cream)", minHeight: 500 }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 36 }}>

            {/* Step 1 - Personal Info */}
            {step === 1 && (
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>Personal Information</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {[["firstName","First Name"],["lastName","Last Name"]].map(([k,l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l}</label>
                      <input value={form[k as keyof typeof form] as string} onChange={e => update(k, e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                {[["email","Email","email"],["phone","Phone","tel"],["currentAddress","Current Address","text"],].map(([k,l,t]) => (
                  <div key={k} style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l}</label>
                    <input type={t} value={form[k as keyof typeof form] as string} onChange={e => update(k, e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                  </div>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
                  {[["city","City"],["state","State"],["zip","ZIP"]].map(([k,l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l}</label>
                      <input value={form[k as keyof typeof form] as string} onChange={e => update(k, e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <button onClick={() => setStep(2)} style={{ width: "100%", background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15 }}>
                  Next → RV Information
                </button>
              </div>
            )}

            {/* Step 2 - RV Info */}
            {step === 2 && (
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>RV Information</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {[["rvMake","Make"],["rvModel","Model"],["rvYear","Year"],["rvLength","Length (ft)"]].map(([k,l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l}</label>
                      <input value={form[k as keyof typeof form] as string} onChange={e => update(k, e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                  {[["adults","Adults"],["children","Children"],["pets","Pets (#)"]].map(([k,l]) => (
                    <div key={k}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l}</label>
                      <input type="number" value={form[k as keyof typeof form] as string} onChange={e => update(k, e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                {parseInt(form.pets) > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Pet Description (breed, size)</label>
                    <input value={form.petDescription} onChange={e => update("petDescription", e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                  <button onClick={() => setStep(1)} style={{ flex: 1, background: "var(--gray-light)", color: "var(--black)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15 }}>← Back</button>
                  <button onClick={() => setStep(3)} style={{ flex: 2, background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15 }}>Next → Stay Details</button>
                </div>
              </div>
            )}

            {/* Step 3 - Stay Details */}
            {step === 3 && (
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>Stay Details</h2>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 10 }}>Stay Type</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]].map(([v,l]) => (
                      <div key={v} onClick={() => update("stayType", v)} style={{ border: `2px solid ${form.stayType === v ? "var(--black)" : "var(--border)"}`, background: form.stayType === v ? "var(--black)" : "var(--white)", color: form.stayType === v ? "var(--white)" : "var(--black)", borderRadius: 6, padding: "12px", textAlign: "center", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                        {l}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Expected Arrival Date</label>
                  <input type="date" value={form.arrivalDate} onChange={e => update("arrivalDate", e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Emergency Contact Name</label>
                  <input value={form.emergencyName} onChange={e => update("emergencyName", e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Emergency Contact Phone</label>
                  <input type="tel" value={form.emergencyPhone} onChange={e => update("emergencyPhone", e.target.value)} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                </div>

                {/* Background Check */}
                <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, padding: 16, marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>🔍 Background Check Required</div>
                  <p style={{ fontSize: 13, color: "#713f12", lineHeight: 1.7, marginBottom: 12 }}>
                    All new residents must complete a background check. Click below to start the process through our trusted partner.
                  </p>
                  <a href="#" target="_blank" rel="noreferrer" style={{ display: "inline-block", background: "var(--black)", color: "var(--white)", padding: "10px 20px", borderRadius: 4, fontWeight: 700, fontSize: 13 }}>
                    🔍 Start Background Check →
                  </a>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.agreeBackground} onChange={e => update("agreeBackground", e.target.checked)} style={{ marginTop: 3 }} />
                    <span style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6 }}>I have completed or will complete the background check before my arrival.</span>
                  </label>
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={form.agreeRules} onChange={e => update("agreeRules", e.target.checked)} style={{ marginTop: 3 }} />
                    <span style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6 }}>I agree to the park rules and regulations.</span>
                  </label>
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={() => setStep(2)} style={{ flex: 1, background: "var(--gray-light)", color: "var(--black)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15 }}>← Back</button>
                  <button onClick={() => setStep(4)} disabled={!form.agreeRules || !form.agreeBackground} style={{ flex: 2, background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15, opacity: (!form.agreeRules || !form.agreeBackground) ? 0.5 : 1 }}>Next → Review</button>
                </div>
              </div>
            )}

            {/* Step 4 - Review */}
            {step === 4 && (
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>Review Your Application</h2>
                <div style={{ background: "var(--cream)", borderRadius: 6, padding: 20, marginBottom: 24 }}>
                  {[
                    ["Name", `${form.firstName} ${form.lastName}`],
                    ["Email", form.email],
                    ["Phone", form.phone],
                    ["RV", `${form.rvYear} ${form.rvMake} ${form.rvModel} (${form.rvLength} ft)`],
                    ["Guests", `${form.adults} adults, ${form.children} children, ${form.pets} pets`],
                    ["Stay Type", form.stayType],
                    ["Arrival", form.arrivalDate],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
                      <span style={{ color: "var(--gray)", fontWeight: 500 }}>{k}</span>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <button style={{ width: "100%", background: "var(--red)", color: "var(--white)", border: "none", borderRadius: 6, padding: 16, fontWeight: 700, fontSize: 15, letterSpacing: "0.05em" }}>
                  ✓ Submit Application
                </button>
                <p style={{ fontSize: 12, color: "var(--gray)", textAlign: "center", marginTop: 12 }}>We'll review your application and contact you within 24-48 hours.</p>
              </div>
            )}

          </div>
        </div>
      </section>
    </>
  );
}
