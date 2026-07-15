"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Lease = {
  id: string;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  status: string | null;
  lease_document_url: string | null;
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function DocumentsPage() {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadLeases();
  }, []);

  async function loadLeases() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("resident_leases")
      .select("id, lease_start, lease_end, monthly_rent, security_deposit, status, lease_document_url")
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("LEASES ERROR:", error);
      setMessage("Could not load your documents.");
      setLoading(false);
      return;
    }

    setLeases(data || []);
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8 }}>My Documents</h1>
      <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 14 }}>
        View and download your signed lease agreement(s).
      </p>

      {message && <p style={{ color: "#dc2626", fontSize: 14 }}>{message}</p>}

      {loading ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading...</p>
      ) : leases.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>No lease documents on file yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {leases.map((lease) => (
            <div
              key={lease.id}
              style={{
                border: "2px solid var(--black)",
                borderRadius: 8,
                padding: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
                  Lease Agreement
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  {formatDate(lease.lease_start)} — {formatDate(lease.lease_end)}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  ${lease.monthly_rent}/mo · Deposit: ${lease.security_deposit || 0}
                </div>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: lease.status === "Active" ? "#dcfce7" : "#f3f4f6",
                    color: lease.status === "Active" ? "#166534" : "#6b7280",
                  }}
                >
                  {lease.status}
                </span>
              </div>

              {lease.lease_document_url ? (
                
                  href={lease.lease_document_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: "var(--black)",
                    color: "#fff",
                    padding: "10px 20px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  📄 View / Print PDF
                </a>
              ) : (
                <span style={{ fontSize: 13, color: "#9ca3af" }}>PDF not available</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
