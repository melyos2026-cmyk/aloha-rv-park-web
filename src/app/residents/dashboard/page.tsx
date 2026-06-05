"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function ResidentDashboard() {
  const [user, setUser] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [resident, setResident] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);

      const { data: res } = await supabase.from("residents").select("*").eq("user_id", user.id).single();
      if (res) {
        setResident(res);
        const { data: inv } = await supabase.from("invoices").select("*").eq("resident_id", res.id).order("sent_date", { ascending: false });
        setInvoices(inv || []);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 16, color: "var(--gray)" }}>Loading your account...</div>
    </div>
  );

  return (
    <>
      <section style={{ background: "var(--black)", color: "var(--white)", padding: "40px 24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--red)", fontWeight: 600, marginBottom: 8 }}>Resident Portal</div>
            <h1 style={{ fontSize: "clamp(24px, 4vw, 40px)", fontWeight: 900 }}>
              Welcome, {resident?.name || user?.email}
            </h1>
            <div style={{ fontSize: 14, color: "#9ca3af", marginTop: 4 }}>Lot {resident?.lot_id} · Aloha RV Park</div>
          </div>
          <button onClick={handleLogout} style={{ background: "transparent", color: "var(--white)", border: "2px solid #374151", borderRadius: 6, padding: "10px 20px", fontWeight: 600, fontSize: 14 }}>
            Sign Out
          </button>
        </div>
      </section>

      <section style={{ padding: "40px 24px", background: "var(--cream)", minHeight: 500 }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>

          {/* Account Summary */}
          {resident && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 40 }}>
              {[
                ["🏠", "Your Lot", resident.lot_id],
                ["💰", "Monthly Rent", `$${resident.rent_amount}`],
                ["⚡", "kWh Included", "1,000 kWh/mo"],
                ["📞", "Contact", resident.phone || "—"],
              ].map(([icon, label, value]) => (
                <div key={label as string} style={{ background: "var(--white)", border: "2px solid var(--black)", borderRadius: 8, padding: 24 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 12, color: "var(--gray)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label as string}</div>
                  <div style={{ fontSize: 20, fontFamily: "Playfair Display, serif", fontWeight: 700 }}>{value as string}</div>
                </div>
              ))}
            </div>
          )}

          {/* Invoices */}
          <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 20 }}>Your Invoices</h2>

          {invoices.length === 0 ? (
            <div style={{ background: "var(--white)", border: "2px solid var(--border)", borderRadius: 8, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No invoices yet</div>
              <div style={{ fontSize: 13, color: "var(--gray)" }}>Your invoices will appear here once sent by the office.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {invoices.map(inv => (
                <div key={inv.id} style={{ background: "var(--white)", border: `2px solid ${inv.paid ? "var(--border)" : "var(--black)"}`, borderRadius: 8, padding: 28 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--gray)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                        Invoice · {new Date(inv.sent_date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 900 }}>Lot {inv.lot_id} — {inv.tenant_name}</div>
                    </div>
                    <div style={{ background: inv.paid ? "#dcfce7" : "#fef2f2", color: inv.paid ? "#16a34a" : "var(--red)", padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                      {inv.paid ? "✓ PAID" : "UNPAID"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
                    {[
                      ["Rent", `$${inv.rent_amount}`],
                      ["kWh Used", `${inv.kwh_used} kWh`],
                      ["Electricity Extra", inv.electricity_extra > 0 ? `$${inv.electricity_extra.toFixed(2)}` : "—"],
                      ["Due Date", new Date(inv.due_date).toLocaleDateString("en-US")],
                    ].map(([k, v]) => (
                      <div key={k as string} style={{ background: "var(--cream)", borderRadius: 6, padding: "12px 16px" }}>
                        <div style={{ fontSize: 11, color: "var(--gray)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{k as string}</div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{v as string}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                    <div>
                      <span style={{ fontSize: 13, color: "var(--gray)" }}>Total Due: </span>
                      <span style={{ fontSize: 24, fontFamily: "Playfair Display, serif", fontWeight: 700, color: inv.paid ? "var(--gray)" : "var(--black)" }}>${inv.total_due}</span>
                    </div>
                    {!inv.paid && (
                      <button style={{ background: "var(--red)", color: "var(--white)", border: "none", borderRadius: 6, padding: "12px 24px", fontWeight: 700, fontSize: 14 }}>
                        💳 Pay Now
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
