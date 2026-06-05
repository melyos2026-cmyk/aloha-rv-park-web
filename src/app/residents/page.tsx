"use client";
import { useState } from "react";

export default function ResidentsPage() {
  const [tab, setTab] = useState<"rent"|"electric"|"propane">("rent");

  return (
    <>
      {/* Hero */}
      <section style={{ background: "var(--black)", color: "var(--white)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 12 }}>Resident Portal</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16 }}>Pay Online</h1>
        <p style={{ fontSize: 16, color: "#9ca3af", maxWidth: 500, margin: "0 auto" }}>
          Manage your payments securely from anywhere.
        </p>
      </section>

      {/* Tabs */}
      <section style={{ background: "var(--white)", borderBottom: "2px solid var(--black)", padding: "0 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "flex" }}>
          {([["rent","🏠 Rent"],["electric","⚡ Electricity"],["propane","⛽ Propane"]] as const).map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "18px 28px", fontWeight: 700, fontSize: 14,
              background: "none", border: "none",
              borderBottom: tab === t ? "3px solid var(--red)" : "3px solid transparent",
              color: tab === t ? "var(--red)" : "var(--gray)",
              letterSpacing: "0.03em", transition: "color 0.2s"
            }}>{l}</button>
          ))}
        </div>
      </section>

      {/* Content */}
      <section style={{ padding: "60px 24px", background: "var(--cream)", minHeight: 500 }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>

          {/* Rent */}
          {tab === "rent" && (
            <div>
              <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 8 }}>Monthly Rent</h2>
              <p style={{ color: "var(--gray)", marginBottom: 32, fontSize: 14 }}>Water & sewer included. Pay your monthly rent securely online.</p>
              <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 32, marginBottom: 24 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  {[["Peak Season (Jan–Apr, Oct–Dec)","$750/mo"],["Off-Peak Season (May–Sep)","$600/mo"]].map(([l,v]) => (
                    <div key={l} style={{ background: "var(--cream)", borderRadius: 6, padding: 16 }}>
                      <div style={{ fontSize: 12, color: "var(--gray)", marginBottom: 4 }}>{l}</div>
                      <div style={{ fontSize: 24, fontFamily: "Playfair Display, serif", fontWeight: 700 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
                  {[["Lot Number","text","e.g. A1"],["Full Name","text","John Doe"],["Email","email","you@email.com"],["Phone","tel","407-555-0000"]].map(([l,t,p]) => (
                    <div key={l as string}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l as string}</label>
                      <input type={t as string} placeholder={p as string} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <button style={{ width: "100%", background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "16px", fontWeight: 700, fontSize: 15, letterSpacing: "0.05em" }}>
                  💳 Pay Rent Now
                </button>
                <p style={{ fontSize: 12, color: "var(--gray)", textAlign: "center", marginTop: 12 }}>Secure payment powered by Square</p>
              </div>
            </div>
          )}

          {/* Electricity */}
          {tab === "electric" && (
            <div>
              <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 8 }}>Electricity</h2>
              <p style={{ color: "var(--gray)", marginBottom: 32, fontSize: 14 }}>First 1,000 kWh included in rent. Usage above 1,000 kWh is billed at the park rate per kWh.</p>
              <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 32, marginBottom: 24 }}>
                <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, padding: 16, marginBottom: 24 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>⚡ How It Works</div>
                  <div style={{ fontSize: 13, color: "#713f12", lineHeight: 1.7 }}>
                    Your first 1,000 kWh per month are included in your rent. Any usage above 1,000 kWh is charged at the current park rate. Your meter reading is taken on the 1st of each month.
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
                  {[["Lot Number","text","e.g. A1"],["Full Name","text","John Doe"],["Email","email","you@email.com"],["kWh Used This Month","number","e.g. 1250"],["Amount to Pay ($)","number","e.g. 27.50"]].map(([l,t,p]) => (
                    <div key={l as string}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l as string}</label>
                      <input type={t as string} placeholder={p as string} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <button style={{ width: "100%", background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "16px", fontWeight: 700, fontSize: 15, letterSpacing: "0.05em" }}>
                  💳 Pay Electricity Bill
                </button>
                <p style={{ fontSize: 12, color: "var(--gray)", textAlign: "center", marginTop: 12 }}>Secure payment powered by Square</p>
              </div>
            </div>
          )}

          {/* Propane */}
          {tab === "propane" && (
            <div>
              <h2 style={{ fontSize: 32, fontWeight: 900, marginBottom: 8 }}>Propane</h2>
              <p style={{ color: "var(--gray)", marginBottom: 32, fontSize: 14 }}>Order and pay for propane online. We'll confirm your order before filling.</p>
              <div style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 32, marginBottom: 24 }}>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 10 }}>Select Tank Size</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[["20 LB Tank","$18.00"],["30 LB Tank","$30.00"],["40 LB Tank","$36.00"],["Motor Home 40 LB","$4.25/gal"]].map(([l,p]) => (
                      <div key={l} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: "14px 16px", cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--red)")}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{l}</div>
                        <div style={{ fontSize: 13, color: "var(--red)", fontWeight: 700 }}>{p}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>
                  {[["Lot Number","text","e.g. A1"],["Full Name","text","John Doe"],["Email","email","you@email.com"],["Phone","tel","407-555-0000"]].map(([l,t,p]) => (
                    <div key={l as string}>
                      <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>{l as string}</label>
                      <input type={t as string} placeholder={p as string} style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }} />
                    </div>
                  ))}
                </div>
                <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: 6, padding: 14, marginBottom: 24, fontSize: 13, color: "#713f12" }}>
                  ⚠️ After payment, the office will confirm your order. Do not discard old invoices until you receive confirmation.
                </div>
                <button style={{ width: "100%", background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "16px", fontWeight: 700, fontSize: 15, letterSpacing: "0.05em" }}>
                  💳 Pay for Propane
                </button>
                <p style={{ fontSize: 12, color: "var(--gray)", textAlign: "center", marginTop: 12 }}>Secure payment powered by Square</p>
              </div>
            </div>
          )}

        </div>
      </section>
    </>
  );
}
