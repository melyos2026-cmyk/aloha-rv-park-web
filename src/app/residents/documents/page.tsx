"use client";
import { portalConfirm, portalAlert } from "@/components/portalDialog";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { portalBackHref } from "@/components/ResidentPortalNav";
import { usePortalLang, type PortalI18n } from "@/lib/portalI18n";

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

function formatDate(dateStr: string | null, date: PortalI18n["date"]) {
  if (!dateStr) return "—";
  return date(String(dateStr).slice(0, 10), { month: "long", day: "numeric", year: "numeric" });
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  general: "General",
  lease: "Site Rental Agreement",
  id: "ID",
  insurance: "Insurance",
  registration: "Registration",
  move_out_statement: "Move-Out / Cancellation Statement",
  bill_of_sale: "Bill of Sale",
  lease_addendum: "Resident Agreement (signed online)",
};

function documentTypeLabel(documentType: string, t: PortalI18n["t"]) {
  return DOCUMENT_TYPE_LABELS[documentType]
    ? t(DOCUMENT_TYPE_LABELS[documentType])
    : documentType.charAt(0).toUpperCase() + documentType.slice(1);
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
  const { lang, t, st, money, date, err } = usePortalLang();
  // Upload messages are translated when set; this marks the error ones (shown red).
  const [uploadFailed, setUploadFailed] = useState(false);

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
      setMessage(t("Please log in again."));
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/portal/documents?residentId=${residentId}`);
      const result = await res.json();
      if (!res.ok) {
        setMessage(t("Could not load your documents: {detail}", { detail: err(result?.error) || res.status }));
        setLoading(false);
        return;
      }
      setLeases(result.leases || []);
      setOtherDocuments(result.otherDocuments || []);
    } catch (e: any) {
      setMessage(t("Could not load your documents (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
    setLoading(false);
  }

  async function uploadDocument(fileArg?: File) {
    const file = fileArg || uploadFile;
    if (!file) {
      setUploadFailed(true);
      setUploadMessage(t("Please choose a file first."));
      return;
    }

    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setUploadFailed(true);
      setUploadMessage(t("Please log in again."));
      return;
    }

    setUploading(true);
    setUploadFailed(false);
    setUploadMessage("");

    try {
      const cleanFileName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      // Sep 25 (per Mely — full security audit, "no quiero huecos"): the
      // file used to be uploaded directly from the browser to a PUBLIC
      // bucket, meaning its URL worked forever for anyone who ever got
      // hold of it (browser history, a screenshot, etc.) — no login
      // required, no expiry. Now sends the raw file to the server,
      // which uploads it to a PRIVATE bucket after verifying this is
      // really this resident's own session; viewing it later goes
      // through a signed, short-lived URL instead (see loadDocuments /
      // viewDocument below).
      const fileDataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error(t("Could not read file.")));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/portal/upload-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          fileName: cleanFileName,
          fileDataBase64,
          contentType: file.type || "application/octet-stream",
          documentType: uploadType,
          relatedOccupantId: uploadForOccupantId || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setUploadFailed(true);
        setUploadMessage(t("Could not save document: {detail}", { detail: err(result?.error) || res.status }));
        setUploading(false);
        return;
      }

      setUploadMessage(t("✅ Document uploaded."));
      setUploadFile(null);
      setUploadForOccupantId("");
      loadDocuments();
    } catch (e: any) {
      setUploadFailed(true);
      setUploadMessage(t("Could not upload document (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
    setUploading(false);
  }

  async function viewDocument(documentId: string) {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setMessage(t("Please log in again."));
      return;
    }
    try {
      const res = await fetch(
        `/api/portal/document-url?residentId=${residentId}&documentId=${documentId}`
      );
      const result = await res.json();
      if (!res.ok || !result.url) {
        setMessage(err(result?.error) || t("Could not open this document."));
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setMessage(t("Could not open this document: {detail}", { detail: e?.message || String(e) }));
    }
  }

  async function viewLeaseDocument(leaseId: string) {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setMessage(t("Please log in again."));
      return;
    }
    try {
      const res = await fetch(
        `/api/portal/lease-document-url?residentId=${residentId}&leaseId=${leaseId}`
      );
      const result = await res.json();
      if (!res.ok || !result.url) {
        setMessage(err(result?.error) || t("Could not open this document."));
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setMessage(t("Could not open this document: {detail}", { detail: e?.message || String(e) }));
    }
  }

  async function deleteDocument(documentId: string) {
    if (!(await portalConfirm(t("Remove this document?"), { danger: true }))) return;

    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      setMessage(t("Please log in again."));
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
        setMessage(t("Could not remove document: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }
      loadDocuments();
    } catch (e: any) {
      setMessage(t("Could not remove document (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
          <p style={{ color: "#000" }}>{t("Loading your documents...")}</p>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => router.push(portalBackHref("lot"))}
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
          {t("Back")}
        </button>
        <PortalLangSwitcher compact />
        </div>
        <div style={cardStyle}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>{t("My Documents")}</h1>
          <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
            {t("View and download your signed site rental agreement(s) and other documents on file.")}
          </p>
          {/* Signed leases / agreements are kept exactly as signed (English). */}
          {lang !== "en" && <p style={{ marginTop: 8, fontSize: 13, color: "#6b7280" }}>{t("These documents are in English; they are the versions you signed.")}</p>}
        </div>

        {message && (
          <div style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e" }}>
            {message}
          </div>
        )}

        <div style={cardStyle}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 16 }}>{t("SITE RENTAL AGREEMENT(S)")}</p>
          {leases.length === 0 ? (
            <p style={{ color: "#000" }}>{t("No lease documents on file yet.")}</p>
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
                      {t("Site Rental Agreement")}
                    </div>
                    <div style={{ fontSize: 14, color: "#6b7280" }}>
                      {formatDate(lease.lease_start, date)} — {formatDate(lease.lease_end, date)}
                    </div>
                    <div style={{ fontSize: 14, color: "#6b7280" }}>
                      {t("{rent}/mo · Deposit: {deposit}", { rent: money(lease.monthly_rent), deposit: money(lease.security_deposit || 0) })}
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
                      {st(lease.status)}
                    </span>
                  </div>

                  {lease.lease_document_url ? (
                    <button
                      onClick={() => viewLeaseDocument(lease.id)}
                      style={{
                        background: "#000",
                        color: "#fff",
                        padding: "12px 22px",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {t("📄 View / Print PDF")}
                    </button>
                  ) : (
                    <span style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic" }}>{t("PDF not available")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#6b7280", marginBottom: 16 }}>{t("OTHER DOCUMENTS")}</p>

          <div style={{ borderRadius: 10, border: "1px dashed #d1d5db", padding: 20, marginBottom: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#000", marginBottom: 12 }}>
              {t("Upload a document (ID, insurance, registration, etc.)")}
            </p>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
              {t("Choose the type below, then choose a file — it uploads automatically, no extra button to click.")}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              {occupants.length > 0 && (
                <select
                  value={uploadForOccupantId}
                  onChange={(e) => setUploadForOccupantId(e.target.value)}
                  style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}
                >
                  <option value="">{t("This is for: Myself")}</option>
                  {occupants.map((o) => (
                    <option key={o.id} value={o.id}>
                      {t("This is for: {name}", { name: o.full_name })}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
                style={{ border: "1.5px solid #d1d5db", borderRadius: 8, padding: "10px 12px", fontSize: 14 }}
              >
                <option value="id">{t("ID")}</option>
                <option value="insurance">{t("Insurance")}</option>
                <option value="registration">{t("Registration")}</option>
                <option value="general">{t("General")}</option>
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
                <span style={{ fontSize: 13, color: "#6b7280" }}>{t("Uploading...")}</span>
              )}
            </div>
            {uploadMessage && (
              <p style={{ fontSize: 13, marginTop: 10, color: uploadFailed ? "#dc2626" : "#16a34a" }}>
                {uploadMessage}
              </p>
            )}
          </div>

          {otherDocuments.length === 0 ? (
            <p style={{ color: "#6b7280", fontSize: 14 }}>{t("No documents uploaded yet.")}</p>
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
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{documentTypeLabel(doc.document_type, t)}</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => viewDocument(doc.id)}
                      style={{
                        background: "#000",
                        color: "#fff",
                        padding: "10px 18px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 700,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {t("📄 View")}
                    </button>
                    {/* Oct 28: a signed lease addendum is part of the lease record — it can't be removed */}
                    {doc.document_type !== "lease_addendum" && <button
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
                      {t("Delete")}
                    </button>}
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
                ? t("You still need to pay for and start 1 background check.")
                : t("You still need to pay for and start {n} background checks.", { n: pendingBgChecks.length })}
            </p>
            <p style={{ fontSize: 13, color: "#9a3412", marginBottom: 12 }}>
              {t("Uploading an ID here doesn't start the check by itself — head to Background Checks to finish it.")}
            </p>
            <button
              onClick={() => router.push("/residents/background-checks")}
              style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "12px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              {t("Continue to Background Check(s)")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function LoadingText() {
  const { t } = usePortalLang();
  return <>{t("Loading...")}</>;
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <p style={{ color: "#000" }}><LoadingText /></p>
          </div>
        </main>
      }
    >
      <DocumentsContent />
    </Suspense>
  );
}
