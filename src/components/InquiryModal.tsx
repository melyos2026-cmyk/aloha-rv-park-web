"use client";
import { useState } from "react";

export default function InquiryModal({
  listingId,
  listingTitle,
  companyId,
  onClose,
}: {
  listingId: string;
  listingTitle: string;
  companyId: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    preferredDate: "",
    preferredTime: "",
    message: "",
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--white)", borderRadius: 8, padding: 32, maxWidth: 440, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
      >
        {sent ? (
          <>
            <h3 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>Request sent ✅</h3>
            <p style={{ fontSize: 14, color: "var(--gray)", marginBottom: 20 }}>
              We'll reach out shortly to confirm a time for your appointment about "{listingTitle}".
            </p>
            <button onClick={onClose} style={{ background: "var(--red)", color: "var(--white)", padding: "12px 24px", borderRadius: 4, fontWeight: 700, border: "none", cursor: "pointer" }}>
              Close
            </button>
          </>
        ) : (
          <>
            <h3 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Request an Appointment</h3>
            <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 20 }}>{listingTitle}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                placeholder="Full Name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc" }}
              />
              <input
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc" }}
              />
              <input
                placeholder="Phone (optional)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc" }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  value={form.preferredDate}
                  onChange={(e) => setForm({ ...form, preferredDate: e.target.value })}
                  style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc", flex: 1 }}
                />
                <input
                  placeholder="Preferred time"
                  value={form.preferredTime}
                  onChange={(e) => setForm({ ...form, preferredTime: e.target.value })}
                  style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc", flex: 1 }}
                />
              </div>
              <textarea
                placeholder="Message (optional)"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={3}
                style={{ padding: 12, borderRadius: 6, border: "1px solid #ccc", fontFamily: "inherit" }}
              />
            </div>

            <button
              disabled={sending || !form.fullName || !form.email}
              onClick={async () => {
                setSending(true);
                try {
                  const res = await fetch("/api/real-estate-inquiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      companyId,
                      listingId,
                      listingTitle,
                      ...form,
                    }),
                  });
                  if (res.ok) {
                    setSent(true);
                    setForm({ fullName: "", email: "", phone: "", preferredDate: "", preferredTime: "", message: "" });
                  } else {
                    const result = await res.json();
                    alert(result.error || "Something went wrong. Please try again.");
                  }
                } catch (err) {
                  alert("Something went wrong. Please try again.");
                }
                setSending(false);
              }}
              style={{
                marginTop: 20, width: "100%", background: "var(--red)", color: "var(--white)",
                padding: "14px", borderRadius: 6, fontWeight: 700, fontSize: 14, border: "none",
                cursor: sending ? "default" : "pointer", opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? "Sending..." : "Request Appointment"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
