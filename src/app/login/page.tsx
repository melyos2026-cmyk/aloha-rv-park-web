"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgotPassword">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    setPayUrl(null);

    const res = await fetch("/api/portal-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Invalid email or password. Please try again.");
      // Aug 26 (per Mely): login blocked because the move-in "due now"
      // invoice isn't paid yet — the portal-login route sends back a
      // no-login-required /pay-invoice link (same mechanism as the
      // approval email's own Pay Now button) so the resident isn't
      // stuck with no way forward.
      if (res.status === 402 && data.payUrl) {
        setPayUrl(data.payUrl);
      }
      setLoading(false);
      return;
    }

    localStorage.setItem("resident_id", data.id);
    localStorage.setItem("resident_name", data.full_name);
    router.push("/residents/dashboard");
    setLoading(false);
  };

  const handleRequestReset = async () => {
    setResetMessage("Sending...");
    const res = await fetch("/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      setResetMessage(data.error || "Something went wrong.");
      return;
    }
    setResetMessage("If an account exists for that email, a reset link has been sent.");
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
            {mode === "login" ? (
              <>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 24 }}>Sign In</h2>

                {error && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, color: "var(--red)" }}>
                    ⚠️ {error}
                    {payUrl && (
                      <div style={{ marginTop: 10 }}>
                        <a
                          href={payUrl}
                          style={{
                            display: "inline-block",
                            background: "var(--red)",
                            color: "#fff",
                            padding: "8px 16px",
                            borderRadius: 6,
                            fontWeight: 700,
                            textDecoration: "none",
                            fontSize: 13,
                          }}
                        >
                          Pay Invoice Now
                        </a>
                      </div>
                    )}
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

                <div style={{ marginBottom: 12 }}>
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

                <div style={{ textAlign: "right", marginBottom: 20 }}>
                  <button
                    type="button"
                    onClick={() => { setMode("forgotPassword"); setError(""); setResetMessage(""); }}
                    style={{ background: "none", border: "none", color: "var(--black)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                  >
                    Forgot password?
                  </button>
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
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Reset Password</h2>
                <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
                  Enter your email and we'll send you a secure link to set a new password.
                </p>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
                  <input
                    type="text"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }}
                  />
                </div>

                {resetMessage && (
                  <p style={{ fontSize: 13, marginBottom: 16, color: resetMessage.startsWith("If an account") ? "#166534" : "var(--red)" }}>
                    {resetMessage}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleRequestReset}
                  disabled={!email}
                  style={{
                    width: "100%", background: "#d3f8e2", color: "var(--black)",
                    border: "2px solid #16a34a", borderRadius: 6, padding: 16, fontWeight: 700,
                    fontSize: 15, letterSpacing: "0.05em", opacity: !email ? 0.5 : 1
                  }}>
                  Send Reset Link
                </button>

                <button
                  type="button"
                  onClick={() => { setMode("login"); setError(""); setResetMessage(""); }}
                  style={{ background: "none", border: "none", color: "var(--black)", fontSize: 13, textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 16, display: "block" }}
                >
                  ← Back to Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
