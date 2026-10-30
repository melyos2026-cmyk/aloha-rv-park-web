"use client";
import { portalConfirm, portalAlert } from "@/components/portalDialog";

import { useEffect, useState } from "react";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { portalBackHref } from "@/components/ResidentPortalNav";
import { usePortalLang } from "@/lib/portalI18n";

export default function MaintenancePage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  // Oct 28 (per Mely): the park's switch "Residents can send maintenance requests from their portal"
  // (admin Maintenance Requests module). Off by default. null = still loading.
  // When off, residents can still see / cancel requests they already sent.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const { t, st, dateTime, err } = usePortalLang();

  useEffect(() => {
    loadRequests();
    const residentId = localStorage.getItem("resident_id");
    if (residentId) {
      fetch(`/api/portal/fee-settings?residentId=${residentId}`)
        .then((r) => r.json())
        .then((d) => setEnabled(d?.maintenanceRequestsEnabled === true))
        .catch(() => setEnabled(false));
    }
  }, []);

  async function loadRequests() {
    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch(`/api/portal/maintenance-requests?residentId=${residentId}`);
    const result = await res.json();
    setRequests(result.requests || []);
  }

  async function cancelRequest(requestId: string) {
    const confirmed = await portalConfirm(
      t("Are you sure you want to cancel this maintenance request?")
    );

    if (!confirmed) return;

    const residentId = localStorage.getItem("resident_id");
    if (!residentId) return;

    const res = await fetch("/api/portal/cancel-maintenance-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, requestId }),
    });
    const result = await res.json();

    if (!res.ok) {
      setMessage(err(result.error) || t("Could not cancel request."));
      return;
    }

    setMessage(t("Maintenance request cancelled."));
    loadRequests();
  }

  async function createRequest() {
    setMessage("");

    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      window.location.href = "/login";
      return;
    }

    if (!subject.trim()) {
      setMessage(t("Please enter a subject."));
      return;
    }

    const res = await fetch("/api/portal/create-maintenance-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, subject, description, priority }),
    });
    const result = await res.json();

    if (!res.ok) {
      setMessage(err(result.error) || t("Could not create request."));
      return;
    }

    const requestData = result.request;

    fetch("/api/notify-maintenance-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId: requestData.company_id,
        residentId,
        subject: subject.trim(),
        priority,
      }),
    }).catch(() => {});

    if (photoFile && requestData) {
      // Oct 24 (security run): the server uploads the photo (private storage), not the browser.
      const fd = new FormData();
      fd.append("residentId", String(residentId));
      fd.append("requestId", String(requestData.id));
      fd.append("file", photoFile);
      const up = await fetch("/api/portal/maintenance-add-photo", { method: "POST", body: fd });
      if (!up.ok) {
        const j = await up.json().catch(() => ({}));
        setMessage(err(j.error) || t("Your request was sent, but the photo could not be uploaded."));
        loadRequests();
        return;
      }
    }

    setSubject("");
    setDescription("");
    setPriority("Normal");
    setPhotoFile(null);
    setShowForm(false);
    setMessage(t("Maintenance request submitted."));
    loadRequests();
  }

  const cardStyle = {
    borderRadius: 12,
    background: "#fff",
    padding: 32,
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e5e7eb",
  };

  return (
    <main style={{ minHeight: "100vh", padding: 32, backgroundColor: "#f5f6f8" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => (window.location.href = portalBackHref("requests"))}
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 30, fontWeight: 800, color: "#000" }}>{t("Maintenance Requests")}</h1>
              <p style={{ marginTop: 14, fontSize: 16, color: "#000" }}>
                {enabled === false
                  ? t("Maintenance requests are handled by the office — please call or message us.")
                  : t("Report issues and track maintenance progress.")}
              </p>
            </div>
            {enabled === true && (
            <button
              onClick={() => setShowForm(true)}
              style={{
                background: "#000",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t("+ New Request")}
            </button>
            )}
          </div>
        </div>

        {message && (
          <div style={{ borderRadius: 8, background: "#fefce8", padding: 16, fontSize: 14, color: "#854d0e" }}>
            {message}
          </div>
        )}

        {showForm && enabled === true && (
          <div style={cardStyle}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#000", marginBottom: 20 }}>
              {t("New Maintenance Request")}
            </h2>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
            <div style={{ width: "100%" }}>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("Subject")}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  color: "black",
                  fontSize: "15px",
                  fontWeight: 400,
                  padding: "12px 0",
                  border: "none",
                  borderBottom: "1px solid #e5e7eb",
                  outline: "none",
                  background: "transparent",
                  display: "block",
                }}
              />

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("Describe the issue...")}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  color: "black",
                  fontSize: "15px",
                  lineHeight: "1.7",
                  padding: "16px 0",
                  minHeight: "280px",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  resize: "none",
                  display: "block",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: "16px" }}>
              <div style={{ width: "110px" }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                  {t("Priority")}
                </label>

                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    padding: 12,
                    color: "#000",
                    background: "#fff",
                    fontSize: 15,
                    border: "1.5px solid #d1d5db",
                  }}
                >
                  <option value="Low">{t("Low")}</option>
                  <option value="Normal">{t("Normal")}</option>
                  <option value="High">{t("High")}</option>
                </select>
              </div>

              <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "#5f6368" }} title={photoFile ? photoFile.name : t("Attach photo")}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] || null;
                    setPhotoFile(file);
                  }}
                  style={{ display: "none" }}
                />
              </label>

              <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "#5f6368" }} title={t("Take photo")}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0] || null;
                    setPhotoFile(file);
                  }}
                  style={{ display: "none" }}
                />
              </label>

              {photoFile && (
                <span style={{ fontSize: "13px", color: "#5f6368" }}>{photoFile.name}</span>
              )}
              </div>
            </div>

            <div
  style={{
    borderTop: "1px solid #e5e7eb",
    paddingTop: "16px",
    display: "flex",
    alignItems: "center",
    gap: "16px",
  }}
>
  <button
    onClick={createRequest}
    style={{
      background: "#000",
      color: "#fff",
      border: "none",
      fontWeight: 700,
      padding: "10px 22px",
      borderRadius: 8,
      fontSize: 14,
      cursor: "pointer",
    }}
  >
    {t("Submit Request")}
  </button>

  <button
    onClick={() => {
      setShowForm(false);
      setSubject("");
      setDescription("");
      setPriority("Normal");
      setPhotoFile(null);
      setMessage("");
    }}
    style={{
      backgroundColor: "#fff",
      border: "1.5px solid #d1d5db",
      color: "#374151",
      fontWeight: 700,
      padding: "10px 22px",
      borderRadius: 8,
      fontSize: 14,
      cursor: "pointer",
    }}
  >
    {t("Cancel")}
  </button>
</div>
          </div>
        )}

        {requests.length === 0 ? (
          enabled === false ? null : <div style={cardStyle}>
            <p style={{ color: "#000" }}>{t("No maintenance requests found.")}</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {requests.map((request) => (
              <div
                key={request.id}
                style={cardStyle}
              >
                <h2
                  style={{ fontSize: 20, fontWeight: 800, color: "#000", marginBottom: 8 }}
                >
                  {request.subject}
                </h2>

                <p
                  style={{
                    color: "#6b7280",
                    fontSize: "14px",
                    marginBottom: "18px",
                  }}
                >
                  {t("Submitted:")}{" "}
                  {dateTime(request.created_at, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>

                <p
                  style={{
                    color: "#374151",
                    lineHeight: "26px",
                    marginBottom: "20px",
                    fontSize: "15px",
                  }}
                >
                  {request.description || t("No description provided.")}
                </p>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 1fr",
                    rowGap: "12px",
                    columnGap: "16px",
                    alignItems: "center",
                    marginTop: "10px",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#374151" }}>
                    {t("Status:")}
                  </div>

                  <div style={{ color: "#111827", fontWeight: 600 }}>
                    {st(request.status)}
                  </div>

                  <div style={{ fontWeight: 700, color: "#374151" }}>
                    {t("Priority:")}
                  </div>

                  <div style={{ color: "#111827" }}>
                    {st(request.priority)}
                  </div>
                </div>

                {request.status === "Open" && (
                  <button
                    onClick={() => cancelRequest(request.id)}
                    style={{
                      marginTop: "20px",
                      backgroundColor: "#fff",
                      border: "1.5px solid #dc2626",
                      color: "#dc2626",
                      fontWeight: 700,
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {t("Cancel Request")}
                  </button>
                )}

                {request.maintenance_request_photos?.length > 0 && (
                  <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {request.maintenance_request_photos.map((photo: any) => (
                      <a
                        key={photo.id}
                        href={photo.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={photo.file_url}
                          alt={t("Maintenance Photo")}
                          style={{ width: 128, height: 128, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb", display: "block" }}
                        />
                      </a>
                    ))}
                  </div>
                )}

                {request.maintenance_request_notes?.length > 0 && (
                  <div style={{ marginTop: "24px" }}>
                    <div style={{ fontWeight: 700, color: "#374151", marginBottom: "8px" }}>
                      {t("Updates from the office:")}
                    </div>
                    {[...request.maintenance_request_notes]
                      .sort(
                        (a: any, b: any) =>
                          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                      )
                      .map((note: any) => (
                        <div
                          key={note.id}
                          style={{
                            background: "#f9fafb",
                            border: "1px solid #e5e7eb",
                            borderRadius: 8,
                            padding: "10px 14px",
                            marginBottom: 8,
                          }}
                        >
                          <p style={{ margin: 0, color: "#374151", fontSize: 14 }}>{note.note}</p>
                          <p style={{ margin: "4px 0 0", color: "#9ca3af", fontSize: 12 }}>
                            {dateTime(note.created_at, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}