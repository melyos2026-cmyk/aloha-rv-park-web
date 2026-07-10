"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function MaintenancePage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      window.location.href = "/login";
      return;
    }

    const { data } = await supabase
      .from("maintenance_requests")
      .select(`
       *,
       maintenance_request_photos(*)
     `)
      .eq("resident_id", residentId)
      .neq("status", "Cancelled")
      .order("created_at", { ascending: false });

    setRequests(data || []);
  }

  async function cancelRequest(requestId: string) {
    const confirmed = confirm(
      "Are you sure you want to cancel this maintenance request?"
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("maintenance_requests")
      .update({
        status: "Cancelled",
      })
      .eq("id", requestId)
      .eq("status", "Open");

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Maintenance request cancelled.");
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
      setMessage("Please enter a subject.");
      return;
    }

    const { data: residentData, error: residentError } = await supabase
      .from("resident_accounts")
      .select("id, company_id")
      .eq("id", residentId)
      .single();

    if (residentError || !residentData) {
      setMessage("Resident not found.");
      return;
    }

    const { data: requestData, error } = await supabase
      .from("maintenance_requests")
      .insert({
        company_id: residentData.company_id,
        resident_id: residentId,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        status: "Open",
      })
      .select()
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    if (photoFile && requestData) {
      const safeFileName = photoFile.name
        .replace(/[^a-zA-Z0-9.-]/g, "-")
        .toLowerCase();

      const filePath = `${requestData.id}/${Date.now()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from("maintenance-photos")
        .upload(filePath, photoFile);

      if (uploadError) {
        setMessage(uploadError.message);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("maintenance-photos")
        .getPublicUrl(filePath);

      await supabase.from("maintenance_request_photos").insert({
        request_id: requestData.id,
        file_url: publicUrlData.publicUrl,
      });
    }

    setSubject("");
    setDescription("");
    setPriority("Normal");
    setPhotoFile(null);
    setShowForm(false);
    setMessage("Maintenance request submitted.");
    loadRequests();
  }

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: "#ffffff" }}>
      <div style={{ maxWidth: "1100px", margin: "0", padding: "0 24px" }}>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-black">
            Maintenance Requests
          </h1>

          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-lg font-semibold text-black"
            style={{ backgroundColor: "#d3f8e2", border: "1px solid #16a34a" }}
          >
            New Request
          </button>
        </div>

        {message && (
          <div className="rounded-2xl shadow p-4 mb-4 text-sm text-black" style={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb" }}>
            {message}
          </div>
        )}

        {showForm && (
          <div className="bg-white rounded-3xl shadow-lg p-8 mb-6 space-y-5">
            <h2 className="text-xl font-bold text-black">
              New Maintenance Request
            </h2>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "20px", padding: "20px" }}>
            <div style={{ width: "100%" }}>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
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
                placeholder="Describe the issue..."
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
              <div style={{ width: "80px" }}>
                <label className="block text-xs font-semibold mb-2 text-gray-500 uppercase tracking-wide">
                  Priority
                </label>

                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-lg p-3 text-black bg-white text-base"
                  style={{ border: "1px solid #16a34a" }}
                >
                  <option>Low</option>
                  <option>Normal</option>
                  <option>High</option>
                </select>
              </div>

              <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "#5f6368" }} title={photoFile ? photoFile.name : "Attach photo"}>
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

              <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", color: "#5f6368" }} title="Take photo">
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
      backgroundColor: "#d3f8e2",
      border: "1px solid #16a34a",
      color: "black",
      fontWeight: 600,
      padding: "10px 24px",
      borderRadius: "24px",
      cursor: "pointer",
    }}
  >
    Submit Request
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
      backgroundColor: "#d3f8e2",
      border: "1px solid #16a34a",
      color: "black",
      fontWeight: 600,
      padding: "10px 24px",
      borderRadius: "24px",
      cursor: "pointer",
    }}
  >
    Cancel
  </button>
</div>
          </div>
        )}

        {requests.length === 0 ? (
          <div
            className="bg-white rounded-2xl shadow p-6 text-black"
            style={{ border: "1px solid #16a34a", marginTop: "24px" }}
          >
            No maintenance requests found.
          </div>
        ) : (
          <div className="space-y-6" style={{ marginTop: "24px" }}>
            {requests.map((request) => (
              <div
                key={request.id}
                className="bg-white rounded-2xl shadow"
                style={{
                  border: "1px solid #16a34a",
                  padding: "28px",
                }}
              >
                <h2
                  className="text-2xl font-bold text-black"
                  style={{ marginBottom: "8px" }}
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
                  Submitted:{" "}
                  {new Date(request.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </p>

                <p
                  className="text-gray-700"
                  style={{
                    lineHeight: "30px",
                    marginBottom: "24px",
                    fontSize: "16px",
                  }}
                >
                  {request.description || "No description provided."}
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
                    Status:
                  </div>

                  <div style={{ color: "#111827", fontWeight: 600 }}>
                    {request.status}
                  </div>

                  <div style={{ fontWeight: 700, color: "#374151" }}>
                    Priority:
                  </div>

                  <div style={{ color: "#111827" }}>
                    {request.priority}
                  </div>
                </div>

                {request.status === "Open" && (
                  <button
                    onClick={() => cancelRequest(request.id)}
                    style={{
                      marginTop: "24px",
                      backgroundColor: "#fee2e2",
                      border: "1px solid #dc2626",
                      color: "#991b1b",
                      fontWeight: 700,
                      padding: "10px 20px",
                      borderRadius: "999px",
                      cursor: "pointer",
                    }}
                  >
                    Cancel Request
                  </button>
                )}

                {request.maintenance_request_photos?.length > 0 && (
                  <div className="mt-6 flex gap-3 flex-wrap">
                    {request.maintenance_request_photos.map((photo: any) => (
                      <a
                        key={photo.id}
                        href={photo.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={photo.file_url}
                          alt="Maintenance Photo"
                          className="w-32 h-32 object-cover rounded-lg border"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: "20px" }}>
          <button
            onClick={() => (window.location.href = "/residents/dashboard")}
            className="px-4 py-2 rounded-lg font-semibold text-black"
            style={{
              backgroundColor: "#d3f8e2",
              border: "1px solid #16a34a",
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}