"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { validatePassword, PASSWORD_REQUIREMENTS_TEXT } from "@/lib/passwordRules";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function resetPassword() {
    setMessage("");

    if (!token) {
      setMessage("This reset link is invalid. Please request a new one.");
      return;
    }

    const complexityError = validatePassword(password);
    if (complexityError) {
      setMessage(complexityError);
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setMessage(data.error || "Unable to reset password.");
      return;
    }

    setSuccess(true);
    setMessage("Password updated. You can now sign in with your new password.");
    setTimeout(() => router.push("/login"), 2500);
  }

  return (
    <>
      <section style={{ background: "#e1f8f7", color: "var(--black)", padding: "60px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#000000", fontWeight: 600, marginBottom: 12 }}>Resident Portal</div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 900, marginBottom: 16, color: "var(--black)" }}>Reset Password</h1>
      </section>

      <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: 500, borderTop: "6px solid var(--white)" }}>
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <div style={{ background: "var(--white)", border: "2px solid var(--red)", borderRadius: 8, padding: 36 }}>
            {!success ? (
              <>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
                  {PASSWORD_REQUIREMENTS_TEXT}
                </p>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>New Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    onKeyDown={e => e.key === "Enter" && resetPassword()}
                    style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, fontFamily: "DM Sans, sans-serif", outline: "none" }}
                  />
                </div>

                {message && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, marginBottom: 20, fontSize: 13, color: "var(--red)" }}>
                    ⚠️ {message}
                  </div>
                )}

                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={submitting || !password || !confirmPassword}
                  style={{
                    width: "100%", background: "#d3f8e2", color: "var(--black)",
                    border: "2px solid #16a34a", borderRadius: 6, padding: 16, fontWeight: 700,
                    fontSize: 15, letterSpacing: "0.05em",
                    opacity: (submitting || !password || !confirmPassword) ? 0.5 : 1
                  }}>
                  {submitting ? "Updating..." : "Update Password"}
                </button>
              </>
            ) : (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: 16, fontSize: 14, color: "#166534" }}>
                ✅ {message}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
