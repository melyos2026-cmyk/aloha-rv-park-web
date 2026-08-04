"use client";

import { useEffect, useState } from "react";

type Lease = {
  id: string;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  security_deposit: number | null;
  status: string | null;
  lease_document_url: string | null;
};

type OtherDocument = {
  id: string;
  file_name: string;
  file_url: string;
  document_type: string | null;
  created_at?: string;
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  general: "General",
  lease: "Lease Agreement",
  id: "ID",
  insurance: "Insurance",
  registration: "Registration",
  move_out_statement: "Move-Out / Cancellation Statement",
  bill_of_sale: "Bill of Sale",
};

function documentTypeLabel(documentType: string) {
  return (
    DOCUMENT_TYPE_LABELS[documentType] ||
    documentType.charAt(0).toUpperCase() + documentType.slice(1)
  );
}

export default function DocumentsPage() {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [otherDocuments, setOtherDocuments] = useState<OtherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    setLoading(true);
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      setMessage("Please log in again.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/portal/documents?residentId=${residentId}`);
      const result = await res.json();
      if (!res.ok) {
        setMessage("Could not load your documents: " + (result?.error || res.status));
        setLoading(false);
        return;
      }
      setLeases(result.leases || []);
      setOtherDocuments(result.otherDocuments || []);
    } catch (err: any) {
      setMessage("Could not load your documents (unexpected error): " + (err?.message || err));
    }
    setLoading(false);
  }

  const cardStyle = {
    borderRadius: 12,
    background: "#fff",
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e5e7eb",
  };

  const rowStyle = (id: string) => ({
    borderRadius: 10,
    padding: 24,
    display: "flex" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    flexWrap: "wrap" as const,
    gap: 16,
    background: hoveredId === id ? "#f9fafb" : "#fff",
    border: hoveredId === id ? "1.5px solid #9ca3af" : "1px solid #e5e7eb",
    boxShadow: hoveredId === id ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
    transition: "all 0.15s ease",
  });

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", ...cardStyle }}>
          <p style={{ color: "#000" }}>Loading your documents...</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>My Documents</h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
            View and download your signed lease agreement(s) and other documents on file.
          </p>
        </div>

        {message && (
          <div style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e" }}>
            {message}
          </div>
        )}

        <div style={cardStyle}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 16 }}>LEASE AGREEMENT(S)</p>
          {leases.length === 0 ? (
            <p style={{ color: "#000" }}>No lease documents on file yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {leases.map((lease) => (
                <div
                  key={lease.id}
                  onMouseEnter={() => setHoveredId(lease.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={rowStyle(lease.id)}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: "#000", marginBottom: 6 }}>
                      Lease Agreement
                    </div>
                    <div style={{ fontSize: 14, color: "#6b7280" }}>
                      {formatDate(lease.lease_start)} — {formatDate(lease.lease_end)}
                    </div>
                    <div style={{ fontSize: 14, color: "#6b7280" }}>
                      ${lease.monthly_rent}/mo · Deposit: ${lease.security_deposit || 0}
                    </div>
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "4px 12px",
                        borderRadius: 999,
                        background: lease.status === "Active" ? "#dcfce7" : "#f3f4f6",
                        color: lease.status === "Active" ? "#166534" : "#6b7280",
                      }}
                    >
                      {lease.status}
                    </span>
                  </div>

                  {lease.lease_document_url ? (
                    <a
                      href={lease.lease_document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        background: "#000",
                        color: "#fff",
                        padding: "12px 22px",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      📄 View / Print PDF
                    </a>
                  ) : (
                    <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>PDF not available</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {otherDocuments.length > 0 && (
          <div style={cardStyle}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 16 }}>OTHER DOCUMENTS</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {otherDocuments.map((doc) => (
                <div
                  key={doc.id}
                  onMouseEnter={() => setHoveredId(doc.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={rowStyle(doc.id)}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#000" }}>{doc.file_name}</div>
                    {doc.document_type && (
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{documentTypeLabel(doc.document_type)}</div>
                    )}
                  </div>
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: "#000",
                      color: "#fff",
                      padding: "10px 18px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    📄 View
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
