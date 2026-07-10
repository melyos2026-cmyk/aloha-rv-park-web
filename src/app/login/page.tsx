"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    setLoading(true);
    setError("");

    const { data, error: dbError } = await supabase
      .from("resident_accounts")
      .select("*")
      .eq("email", email)
      .is("deleted_at", null)
      .maybeSingle();

    if (dbError || !data || data.portal_password !== password) {
      setError("Invalid email or password. Please try again.");
      setLoading(false);
      return;
    }

    localStorage.setItem("resident_id", data.id);
    localStorage.setItem("resident_name", data.full_name);
    router.push("/residents/dashboard");
    setLoading(false);
  };

  return (
    <>
      <section style={{ background: "#e1f8f7", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#000000", fontWeight: 600, marginBottom: 12 }}>Resident Portal</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16, color: "var(--black)" }}>Resident Login</h1>
        <p style={{ fontSize: 16, color: "#374151", maxWidth: 400, margin: "0 auto" }}>
          Access your account to view invoices and make payments.
        </p>
      </section>

      <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: 500, borderTop: "6px solid var(--white)" }}>
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <div style={{ background: "var(--white)", border: "2px solid var(--red)", borderRadius: 8, padding: 36 }}>
            <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>Sign In</h2>

            {error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, color: "var(--red)" }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
              <input
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }}
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={loading || !email || !password}
              style={{
                width: "100%", background: "#d3f8e2", color: "var(--black)",
                border: "2px solid #16a34a", borderRadius: 6, padding: 16, fontWeight: 700,
                fontSize: 15, letterSpacing: "0.05em",
                opacity: (loading || !email || !password) ? 0.5 : 1
              }}>
              {loading ? "Signing in..." : "Sign In →"}
            </button>

            <p style={{ fontSize: 12, color: "var(--gray)", textAlign: "center", marginTop: 16 }}>
              Don't have an account? Contact the office at <a href="tel:6892520567" style={{ color: "var(--black)", fontWeight: 600 }}>(689) 252-0567</a>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
