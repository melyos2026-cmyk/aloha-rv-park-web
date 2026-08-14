"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

function DocumentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Aug 4 (per Mely): the reminder banner should ONLY show when the
  // resident arrived here specifically via Household Occupants' "Upload
  // ID" button (which links to /residents/documents?forOccupant=<id>) —
  // not for every visit to Documents. Also pre-selects the "This is for"
  // dropdown to that occupant, one less thing to get wrong.
  const forOccupantId = searchParams.get("forOccupant") || "";
  const [leases, setLeases] = useState<Lease[]>([]);
  const [otherDocuments, setOtherDocuments] = useState<OtherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Resident self-upload (Aug 3, per Mely): lets a resident add their own
  // documents (ID, insurance, registration, etc.) so the admin can view
  // them if ever needed.
  const [uploadType, setUploadType] = useState("id");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  // Aug 4 (per Mely): lets a resident tag an uploaded ID as belonging to
  // a specific Household Occupant (needed for the 18+ background check
  // requirement), instead of it just sitting in a generic pile with no
  // link to who it's actually for.
  const [occupants, setOccupants] = useState<any[]>([]);
  const [uploadForOccupantId, setUploadForOccupantId] = useState(forOccupantId);
  // Aug 4 (per Mely): so a resident who came here to upload an ID doesn't
  // get lost afterward — a persistent banner points them back to
  // /residents/background-checks to actually pay for and start the
  // check, since uploading the ID alone doesn't do that.
  const [pendingBgChecks, setPendingBgChecks] = useState<any[]>([]);

  useEffect(() => {
    loadDocuments();
    loadOccupants();
    loadPendingBackgroundChecks();
  }, []);

  async function loadPendingBackgroundChecks() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) return;
    try {
      const res = await fetch(`/api/portal/pending-background-checks?residentId=${residentId}`);
      const result = await res.json();
      setPendingBgChecks(result.pending || []);
    } catch {
      // Non-critical — the reminder banner just won't show if this fails.
    }
  }

  async function loadOccupants() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) return;
    try {
      const res = await fetch(`/api/portal/occupants-vehicles?residentId=${residentId}`);
      const result = await res.json();
      setOccupants((result.occupants || []).filter((o: any) => o.occupant_type !== "visitor"));
    } catch {
      // Non-critical — the "For" selector just won't have occupant
      // options if this fails; the upload itself still works.
    }
  }

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

  async function uploadDocument(fileArg?: File) {
    const file = fileArg || uploadFile;
    if (!file) {
      setUploadMessage("Please choose a file first.");
      return;
    }

    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setUploadMessage("Please log in again.");
      return;
    }

    setUploading(true);
    setUploadMessage("");

    try {
      const cleanFileName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `residents/${residentId}/${Date.now()}-${cleanFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("company-assets")
        .upload(filePath, file);

      if (uploadError) {
        setUploadMessage("Could not upload file: " + uploadError.message);
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage.from("company-assets").getPublicUrl(filePath);

      const res = await fetch("/api/portal/upload-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          fileName: file.name,
          fileUrl: urlData.publicUrl,
          documentType: uploadType,
          relatedOccupantId: uploadForOccupantId || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setUploadMessage("Could not save document: " + (result?.error || res.status));
        setUploading(false);
        return;
      }

      setUploadMessage("✅ Document uploaded.");
      setUploadFile(null);
      setUploadForOccupantId("");
      loadDocuments();
    } catch (err: any) {
      setUploadMessage("Could not upload document (unexpected error): " + (err?.message || err));
    }
    setUploading(false);
  }

  async function deleteDocument(documentId: string) {
    if (!confirm("Remove this document?")) return;

    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setMessage("Please log in again.");
      return;
    }

    try {
      const res = await fetch("/api/portal/delete-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, documentId }),
      });
      const result = await res.json();
      if (!res.ok) {
        setMessage("Could not remove document: " + (result?.error || res.status));
        return;
      }
      loadDocuments();
    } catch (err: any) {
      setMessage("Could not remove document (unexpected error): " + (err?.message || err));
    }
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
        <button
          onClick={() => router.push("/residents/dashboard")}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#111827")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#6b7280")}
          style={{
            alignSelf: "flex-start",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            padding: 0,
            fontSize: 14,
            fontWeight: 600,
            color: "#6b7280",
            cursor: "pointer",
            transition: "color 0.15s ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </button>
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

        <div style={cardStyle}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 16 }}>OTHER DOCUMENTS</p>

          <div style={{ borderRadius: 10, border: "1px dashed #d1d5db", padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#000", marginBottom: 12 }}>
              Upload a document (ID, insurance, registration, etc.)
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              Choose the type below, then choose a file — it uploads automatically, no extra button to click.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {occupants.length > 0 && (
                <select
                  value={uploadForOccupantId}
                  onChange={(e) => setUploadForOccupantId(e.target.value)}
                  style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}
                >
                  <option value="">This is for: Myself</option>
                  {occupants.map((o) => (
                    <option key={o.id} value={o.id}>
                      This is for: {o.full_name}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
                style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}
              >
                <option value="id">ID</option>
                <option value="insurance">Insurance</option>
                <option value="registration">Registration</option>
                <option value="general">General</option>
              </select>
              <input
                type="file"
                onChange={(e) => {
                  // Aug 4 (per Mely): uploads immediately on file selection
                  // instead of requiring a separate click on "Upload" —
                  // residents were choosing a file and stopping there,
                  // not realizing the upload wasn't done yet.
                  const file = e.target.files?.[0] || null;
                  setUploadFile(file);
                  if (file) uploadDocument(file);
                }}
                style={{ fontSize: 14 }}
              />
              {uploading && (
                <span style={{ fontSize: 13, color: "#6b7280" }}>Uploading...</span>
              )}
            </div>
            {uploadMessage && (
              <p style={{ fontSize: 13, marginTop: 10, color: uploadMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>
                {uploadMessage}
              </p>
            )}
          </div>

          {otherDocuments.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 14 }}>No documents uploaded yet.</p>
          ) : (
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
                  <div style={{ display: "flex", gap: 10 }}>
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
                    <button
                      onClick={() => deleteDocument(doc.id)}
                      style={{
                        background: "none",
                        border: "1.5px solid #d1d5db",
                        color: "#dc2626",
                        padding: "10px 16px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {forOccupantId && pendingBgChecks.length > 0 && (
          <div style={{ borderRadius: 8, background: "#fff7ed", border: "2px solid #fb923c", padding: 20 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#9a3412", marginBottom: 8 }}>
              ⚠️ {pendingBgChecks.length === 1
                ? "You still need to pay for and start 1 background check."
                : `You still need to pay for and start ${pendingBgChecks.length} background checks.`}
            </p>
            <p style={{ fontSize: 13, color: "#9a3412", marginBottom: 12 }}>
              Uploading an ID here doesn't start the check by itself — head to Background Checks to finish it.
            </p>
            <button
              onClick={() => router.push("/residents/background-checks")}
              style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Continue to Background Check(s)
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <p style={{ color: "#000" }}>Loading...</p>
          </div>
        </main>
      }
    >
      <DocumentsContent />
    </Suspense>
  );
}
