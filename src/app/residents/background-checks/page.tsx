"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { usePortalLang } from "@/lib/portalI18n";

const card: React.CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };

function BackgroundChecksContent() {
  const [pending, setPending] = useState<any[]>([]);
  const [feeAmount, setFeeAmount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("Loading...");
  const [failed, setFailed] = useState(false);
  const { t, money, err } = usePortalLang();
  const [paying, setPaying] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const justPaid = searchParams.get("paid") === "1";

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      router.push("/login");
      return;
    }
    try {
      const res = await fetch(`/api/portal/pending-background-checks?residentId=${residentId}`);
      const result = await res.json();
      if (!res.ok) {
        setFailed(true);
        setMessage(err(result?.error) || t("Could not load background checks."));
        return;
      }
      setPending(result.pending || []);
      setFeeAmount(result.feeAmount || 0);
      // Default: everything pending is selected, so a resident who just
      // wants to pay for all of them can go straight to Pay Now.
      setSelectedIds(new Set((result.pending || []).map((p: any) => p.id)));
      setMessage("");
    } catch (e: any) {
      setFailed(true);
      setMessage(t("Could not load background checks (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
  }

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function payNow() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId || selectedIds.size === 0) return;
    setPaying(true);
    setFailed(false);
    setMessage("");
    try {
      const res = await fetch("/api/create-occupant-background-check-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, occupantIds: Array.from(selectedIds) }),
      });
      const result = await res.json();
      if (!res.ok || !result.url) {
        setFailed(true);
        setMessage(err(result?.error) || t("Could not start payment."));
        setPaying(false);
        return;
      }
      window.location.href = result.url;
    } catch (e: any) {
      setFailed(true);
      setMessage(t("Could not start payment (unexpected error): {detail}", { detail: e?.message || String(e) }));
      setPaying(false);
    }
  }

  const total = selectedIds.size * feeAmount;

  return (
    <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: "100vh" }}>
      <div style={{ maxWidth: 700, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, marginBottom: 4 }}>{t("Household Background Checks")}</h1>
            <p style={{ color: "var(--gray)", fontSize: 14 }}>{t("Anyone 18 or older living here permanently requires a background check.")}</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <PortalLangSwitcher compact />
          <button
            onClick={() => router.push("/residents/dashboard")}
            style={{ background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
            {t("Back")}
          </button>
          </div>
        </div>

        {justPaid && (
          <div style={{ ...card, border: "1.5px solid #16a34a", background: "#f0fdf4" }}>
            <p style={{ color: "#166534", fontWeight: 700 }}>{t("Payment received — check your email for a message with instructions to complete the background check. This can take a few minutes to arrive.")}</p>
          </div>
        )}

        {message && <p style={{ color: failed ? "#dc2626" : "var(--gray)" }}>{t(message)}</p>}

        <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--gray)" }}>{t("Need to add another household occupant before paying?")}</p>
          <button
            onClick={() => router.push("/residents/dashboard#household-occupants")}
            style={{ background: "#fff", border: "1.5px solid #000", color: "#000", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {t("+ Add Household Occupant")}
          </button>
        </div>

        {pending.length === 0 && !message ? (
          <div style={card}>
            <p style={{ color: "var(--gray)" }}>{t("No background checks are pending right now.")}</p>
          </div>
        ) : (
          <>
            <div style={card}>
              <p style={{ fontSize: 13, color: "var(--gray)", marginBottom: 16 }}>
                {t("Select which occupant(s) to pay for now — you can pay for one, or all of them together in a single charge.")}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pending.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggle(p.id)} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 700 }}>{p.full_name}</p>
                      <p style={{ fontSize: 12, color: "var(--gray)" }}>{p.relationship}</p>
                    </div>
                    <p style={{ fontWeight: 700 }}>{money(feeAmount)}</p>
                  </label>
                ))}
              </div>
            </div>

            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontWeight: 900 }}>{t("Total ({n} selected)", { n: selectedIds.size })}</span>
                <span style={{ fontWeight: 900 }}>{money(total)}</span>
              </div>
              <button
                onClick={payNow}
                disabled={paying || selectedIds.size === 0}
                style={{ width: "100%", background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: 14, fontWeight: 700, cursor: paying ? "default" : "pointer", opacity: paying || selectedIds.size === 0 ? 0.6 : 1 }}
              >
                {paying ? t("Redirecting to payment...") : t("Pay Now & Start Background Check(s)")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function LoadingText() {
  const { t } = usePortalLang();
  return <>{t("Loading...")}</>;
}

export default function BackgroundChecksPage() {
  return (
    <Suspense
      fallback={
        <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: "100vh" }}>
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <div style={card}>
              <p style={{ color: "var(--gray)" }}><LoadingText /></p>
            </div>
          </div>
        </section>
      }
    >
      <BackgroundChecksContent />
    </Suspense>
  );
}
