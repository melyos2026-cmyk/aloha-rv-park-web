"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

const card: React.CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };
const cardAccent: React.CSSProperties = { ...card, border: "2px solid var(--red)" };
const label = { color: "var(--gray)", fontSize: 13, marginBottom: 4 };
const bigNumber = { fontSize: 26, fontWeight: 900 };

export default function ResidentDashboard() {
  const [resident, setResident] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [occupants, setOccupants] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [message, setMessage] = useState("Loading...");
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [electricUsage, setElectricUsage] = useState<any[]>([]);
  const router = useRouter();

  const [editingInfo, setEditingInfo] = useState(false);
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmergencyName, setFormEmergencyName] = useState("");
  const [formEmergencyPhone, setFormEmergencyPhone] = useState("");
  const [formEmergencyRelationship, setFormEmergencyRelationship] = useState("");

  const [addingOccupant, setAddingOccupant] = useState(false);
  const [occType, setOccType] = useState("household");
  const [occFullName, setOccFullName] = useState("");
  const [occRelationship, setOccRelationship] = useState("");
  const [occPhone, setOccPhone] = useState("");
  const [occEmail, setOccEmail] = useState("");
  const [occStayStart, setOccStayStart] = useState("");
  const [occStayEnd, setOccStayEnd] = useState("");
  const [editingVisitorId, setEditingVisitorId] = useState<string | null>(null);

  const [addingVehicle, setAddingVehicle] = useState(false);
  const [vehMake, setVehMake] = useState("");
  const [vehModel, setVehModel] = useState("");
  const [vehYear, setVehYear] = useState("");
  const [vehColor, setVehColor] = useState("");
  const [vehPlate, setVehPlate] = useState("");
  const [vehState, setVehState] = useState("");

  const outstandingBalance = payments.reduce((sum, payment) => {
    if (payment.status === "Pending" || payment.status === "Late" || payment.status === "Partial") {
      return sum + Number(payment.total_due || payment.amount || 0);
    }
    return sum;
  }, 0);

  useEffect(() => {
    loadResidentDashboard();
  }, []);

  async function loadResidentDashboard() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      router.push("/login");
      return;
    }

    const { data: residentData, error: residentError } = await supabase
      .from("resident_accounts")
      .select("*, rv_lots(lot_name)")
      .eq("id", residentId)
      .single();

    if (residentError || !residentData) {
      setMessage("Resident not found.");
      return;
    }
    setResident(residentData);

    const { data: electricData } = await supabase
      .from("resident_electric_readings")
      .select("*")
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false })
      .limit(12);
    setElectricUsage(electricData || []);

    const { data: docs } = await supabase
      .from("resident_documents")
      .select("*")
      .eq("resident_id", residentId);
    setDocuments(docs || []);

    const { data: occs } = await supabase
      .from("resident_occupants")
      .select("*")
      .eq("resident_id", residentId);
    setOccupants(occs || []);

    const { data: cars } = await supabase
      .from("resident_vehicles")
      .select("*")
      .eq("resident_id", residentId);
    setVehicles(cars || []);

    const { data: pays } = await supabase
      .from("resident_payments")
      .select("*")
      .eq("resident_id", residentId)
      .in("status", ["Pending", "Late", "Partial"])
      .order("due_date", { ascending: true });
    setPayments(pays || []);

    const { data: anns } = await supabase
      .from("announcements")
      .select("*")
      .eq("company_id", residentData.company_id)
      .order("created_at", { ascending: false });
    setAnnouncements(anns || []);

    setMessage("");
  }

  async function handlePayNow() {
    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      router.push("/login");
      return;
    }

    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ residentId }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not start payment.");
      return;
    }

    window.location.href = data.url;
  }

  function logout() {
    localStorage.removeItem("resident_id");
    localStorage.removeItem("resident_name");
    router.push("/login");
  }

  async function notifyAdmin(updateType: string, message: string) {
    if (!resident) return;
    await supabase.from("resident_update_notifications").insert({
      company_id: resident.company_id,
      resident_id: resident.id,
      resident_name: resident.full_name,
      update_type: updateType,
      message,
    });
  }

  function openEditInfo() {
    setFormPhone(resident.phone || "");
    setEditingInfo(true);
  }

  async function saveResidentInfo() {
    const { error } = await supabase
      .from("resident_accounts")
      .update({
        phone: formPhone.trim(),
      })
      .eq("id", resident.id);

    if (error) {
      alert("Could not save changes: " + error.message);
      return;
    }

    await notifyAdmin(
      "resident_info",
      `${resident.full_name} updated their phone number to ${formPhone.trim()}.`
    );

    setEditingInfo(false);
    loadResidentDashboard();
  }

  async function addOccupant() {
    if (!occFullName.trim()) {
      alert("Please enter a full name.");
      return;
    }

    if (editingVisitorId) {
      const { error } = await supabase
        .from("resident_occupants")
        .update({
          full_name: occFullName.trim(),
          relationship: occRelationship.trim(),
          phone: occPhone.trim(),
          email: occEmail.trim().toLowerCase(),
          stay_start_date: occStayStart || null,
          stay_end_date: occStayEnd || null,
        })
        .eq("id", editingVisitorId);

      if (error) {
        alert("Could not update visitor: " + error.message);
        return;
      }

      await notifyAdmin(
        "visitor_updated",
        `${resident.full_name} updated a visitor: ${occFullName.trim()}.`
      );
    } else {
      const { error } = await supabase.from("resident_occupants").insert({
        company_id: resident.company_id,
        resident_id: resident.id,
        occupant_type: occType,
        full_name: occFullName.trim(),
        relationship: occRelationship.trim(),
        phone: occPhone.trim(),
        email: occEmail.trim().toLowerCase(),
        stay_start_date: occType === "visitor" ? (occStayStart || null) : null,
        stay_end_date: occType === "visitor" ? (occStayEnd || null) : null,
      });

      if (error) {
        alert("Could not add: " + error.message);
        return;
      }

      await notifyAdmin(
        occType === "visitor" ? "visitor_added" : "occupant_added",
        `${resident.full_name} added a new ${occType === "visitor" ? "visitor" : "household occupant"}: ${occFullName.trim()}.`
      );
    }

    setOccFullName("");
    setOccRelationship("");
    setOccPhone("");
    setOccEmail("");
    setOccStayStart("");
    setOccStayEnd("");
    setOccType("household");
    setEditingVisitorId(null);
    setAddingOccupant(false);
    loadResidentDashboard();
  }

  function startEditVisitor(person: any) {
    setEditingVisitorId(person.id);
    setOccFullName(person.full_name || "");
    setOccRelationship(person.relationship || "");
    setOccPhone(person.phone || "");
    setOccEmail(person.email || "");
    setOccStayStart(person.stay_start_date || "");
    setOccStayEnd(person.stay_end_date || "");
    setOccType("visitor");
    setAddingOccupant(true);
  }

  async function deleteVisitor(id: string) {
    if (!confirm("Remove this visitor?")) return;

    const { error } = await supabase.from("resident_occupants").delete().eq("id", id);

    if (error) {
      alert("Could not remove visitor: " + error.message);
      return;
    }

    await notifyAdmin("visitor_removed", `${resident.full_name} removed a visitor.`);
    loadResidentDashboard();
  }

  async function addVehicle() {
    if (!vehPlate.trim()) {
      alert("Please enter a license plate.");
      return;
    }

    const { error } = await supabase.from("resident_vehicles").insert({
      company_id: resident.company_id,
      resident_id: resident.id,
      vehicle_make: vehMake.trim(),
      vehicle_model: vehModel.trim(),
      vehicle_year: vehYear.trim(),
      color: vehColor.trim(),
      license_plate: vehPlate.trim(),
      license_state: vehState.trim(),
    });

    if (error) {
      alert("Could not add vehicle: " + error.message);
      return;
    }

    await notifyAdmin(
      "vehicle_added",
      `${resident.full_name} added a new vehicle: ${vehYear} ${vehMake} ${vehModel} (Plate: ${vehPlate}).`
    );

    setVehMake("");
    setVehModel("");
    setVehYear("");
    setVehColor("");
    setVehPlate("");
    setVehState("");
    setAddingVehicle(false);
    loadResidentDashboard();
  }

  if (!resident) {
    return (
      <div style={{ padding: 60, textAlign: "center", background: "#f6f5f5", minHeight: "100vh" }}>
        <p>{message}</p>
      </div>
    );
  }

  return (
    <>
      <section style={{ background: "#e1f8f7", color: "var(--black)", padding: "60px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#d3f8e2", fontWeight: 600, marginBottom: 8 }}>Resident Portal</div>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, marginBottom: 4 }}>Welcome, {resident.full_name}</h1>
            <p style={{ color: "#000000", fontSize: 14 }}>{resident.rv_lots?.lot_name ? `Lot ${resident.rv_lots.lot_name}` : "Aloha RV Park"}</p>
          </div>
          <button onClick={logout} style={{ background: "transparent", border: "1.5px solid #000000", color: "#000000", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
            Sign Out
          </button>
        </div>
      </section>

      <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: 500 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Quick links */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <button onClick={() => router.push("/residents/payments")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>💳 Payments</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View and pay outstanding charges.</p>
            </button>
            <button onClick={() => router.push("/residents/payment-history")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📜 Payment History</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View completed payments.</p>
            </button>
          </div>

          {/* Announcements */}
          {announcements.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Announcements</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {announcements.map(a => (
                  <div key={a.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12 }}>
                    <p style={{ fontWeight: 700 }}>{a.title}</p>
                    <p style={{ color: "var(--gray)", fontSize: 13 }}>{a.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resident + Emergency info */}
          {!editingInfo ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>Resident Information</h2>
                  <button onClick={openEditInfo} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit Phone</button>
                </div>
                <p><strong>Email:</strong> {resident.email || "No email"}</p>
                <p style={{ fontSize: 11, color: "var(--gray)" }}>To change your email, please contact park management.</p>
                <p style={{ marginTop: 8 }}><strong>Phone:</strong> {resident.phone || "No phone"}</p>
              </div>
              <div style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Emergency Contact</h2>
                <p><strong>Name:</strong> {resident.emergency_contact_name || "None"}</p>
                <p><strong>Phone:</strong> {resident.emergency_contact_phone || "None"}</p>
                <p><strong>Relationship:</strong> {resident.emergency_contact_relationship || "None"}</p>
              </div>
            </div>
          ) : (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Edit Phone Number</h2>
              <input placeholder="Phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button onClick={saveResidentInfo} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save</button>
                <button onClick={() => setEditingInfo(false)} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Rent / Balance */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              <p style={label}>Rent Amount</p>
              <p style={bigNumber}>${resident.rent_amount}</p>
            </div>
            <div style={cardAccent}>
              <p style={label}>Outstanding Balance</p>
              <p style={{ fontSize: 30, fontWeight: 900, color: "#b91c1c" }}>${outstandingBalance.toFixed(2)}</p>
              <button
                onClick={handlePayNow}
                style={{ marginTop: 12, background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
              >
                Pay Now
              </button>
            </div>
          </div>

          {/* Outstanding charges list */}
          {payments.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Outstanding Charges</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {payments.map(p => (
                  <div key={p.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <p style={{ fontWeight: 700 }}>{p.custom_charge_name || p.charge_type || "Charge"}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{p.notes || "No notes"}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 900 }}>${Number(p.total_due || p.amount || 0).toFixed(2)}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{p.status}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1.5px solid var(--border)", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 900 }}>Total Due</span>
                <span style={{ fontWeight: 900 }}>${outstandingBalance.toFixed(2)}</span>
              </div>
              <button
                onClick={handlePayNow}
                style={{ marginTop: 16, width: "100%", background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: 14, fontWeight: 700, cursor: "pointer" }}
              >
                Pay Online
              </button>
            </div>
          )}

          {/* Maintenance link */}
          <div onClick={() => router.push("/residents/maintenance")} style={{ ...card, cursor: "pointer" }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Maintenance Requests</h2>
            <p style={{ color: "var(--gray)", fontSize: 13 }}>Report issues and track maintenance progress.</p>
          </div>

          {/* Electric usage */}
          <div style={card}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>⚡ Electric Usage</h2>
            {electricUsage.length === 0 ? (
              <p style={{ color: "var(--gray)" }}>No electric usage available yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><p style={label}>Billing Month</p><p style={bigNumber}>{electricUsage[0]?.billing_month || "N/A"}</p></div>
                <div><p style={label}>Meter Number</p><p style={bigNumber}>{electricUsage[0]?.meter_number || "N/A"}</p></div>
                <div><p style={label}>Current Reading</p><p style={bigNumber}>{electricUsage[0]?.current_reading || 0}</p></div>
                <div><p style={label}>Previous Reading</p><p style={bigNumber}>{electricUsage[0]?.previous_reading || 0}</p></div>
                <div><p style={label}>Total Usage</p><p style={bigNumber}>{electricUsage[0]?.usage_kwh || 0} kWh</p></div>
                <div><p style={label}>Included kWh</p><p style={bigNumber}>{electricUsage[0]?.included_kwh || 0} kWh</p></div>
                <div><p style={label}>Billable kWh</p><p style={bigNumber}>{electricUsage[0]?.billable_kwh || 0} kWh</p></div>
                <div><p style={label}>Rate per kWh</p><p style={bigNumber}>${Number(electricUsage[0]?.rate_per_kwh || 0).toFixed(2)}</p></div>
                <div style={{ gridColumn: "span 2", borderTop: "1.5px solid var(--border)", paddingTop: 16 }}>
                  <p style={label}>Electric Charge</p>
                  <p style={{ fontSize: 30, fontWeight: 900, color: "#b91c1c" }}>${Number(electricUsage[0]?.charge_amount || 0).toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>

          {electricUsage.length > 0 && (
            <button onClick={() => router.push("/electric-history")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📊 Electric Usage History</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View monthly electric readings, charges, and usage history.</p>
            </button>
          )}

          {/* Documents */}
          <div style={card}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Documents</h2>
            {documents.map(doc => (
              <div key={doc.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{doc.file_name}</p>
                <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={{ color: "#1e40af", fontSize: 13 }}>Open Document</a>
              </div>
            ))}
            {documents.length === 0 && <p style={{ color: "var(--gray)" }}>No documents available.</p>}
          </div>

          {/* Household Occupants */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>Household Occupants</h2>
              <button onClick={() => { setOccType("household"); setEditingVisitorId(null); setAddingOccupant(!addingOccupant); }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingOccupant && occType === "household" && !editingVisitorId ? "Cancel" : "+ Add"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--gray)", marginBottom: 12 }}>People living here permanently. Contact park management to edit or remove.</p>

            {addingOccupant && occType === "household" && !editingVisitorId && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder="Full Name" value={occFullName} onChange={e => setOccFullName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Relationship" value={occRelationship} onChange={e => setOccRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Phone" value={occPhone} onChange={e => setOccPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Email" value={occEmail} onChange={e => setOccEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save</button>
              </div>
            )}

            {occupants.filter(p => p.occupant_type !== "visitor").map(person => (
              <div key={person.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{person.full_name}</p>
                <p style={{ fontSize: 13 }}>{person.relationship}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{person.phone} {person.email}</p>
              </div>
            ))}
            {occupants.filter(p => p.occupant_type !== "visitor").length === 0 && <p style={{ color: "var(--gray)" }}>No household occupants listed.</p>}
          </div>

          {/* Visitors */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>Visitors</h2>
              <button onClick={() => { setOccType("visitor"); setEditingVisitorId(null); setOccFullName(""); setOccRelationship(""); setOccPhone(""); setOccEmail(""); setOccStayStart(""); setOccStayEnd(""); setAddingOccupant(!addingOccupant || occType !== "visitor"); }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingOccupant && occType === "visitor" ? "Cancel" : "+ Add"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--gray)", marginBottom: 12 }}>Temporary guests. You can add, edit, or remove these anytime.</p>

            {addingOccupant && occType === "visitor" && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder="Full Name" value={occFullName} onChange={e => setOccFullName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Relationship" value={occRelationship} onChange={e => setOccRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Phone" value={occPhone} onChange={e => setOccPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Email" value={occEmail} onChange={e => setOccEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Stay Start Date</label>
                    <input type="date" value={occStayStart} onChange={e => setOccStayStart(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Stay End Date</label>
                    <input type="date" value={occStayEnd} onChange={e => setOccStayEnd(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {editingVisitorId ? "Update Visitor" : "Save Visitor"}
                </button>
              </div>
            )}

            {occupants.filter(p => p.occupant_type === "visitor").map(person => (
              <div key={person.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{person.full_name}</p>
                <p style={{ fontSize: 13 }}>{person.relationship}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{person.phone} {person.email}</p>
                {(person.stay_start_date || person.stay_end_date) && (
                  <p style={{ color: "var(--gray)", fontSize: 12 }}>
                    Stay: {person.stay_start_date || "?"} to {person.stay_end_date || "?"}
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => startEditVisitor(person)} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>Edit</button>
                  <button onClick={() => deleteVisitor(person.id)} style={{ background: "#fff", color: "#dc2626", border: "1px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>Remove</button>
                </div>
              </div>
            ))}
            {occupants.filter(p => p.occupant_type === "visitor").length === 0 && <p style={{ color: "var(--gray)" }}>No visitors listed.</p>}
          </div>

          {/* Vehicles */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>Vehicles</h2>
              <button onClick={() => setAddingVehicle(!addingVehicle)} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingVehicle ? "Cancel" : "+ Add"}
              </button>
            </div>

            {addingVehicle && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder="Make" value={vehMake} onChange={e => setVehMake(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Model" value={vehModel} onChange={e => setVehModel(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Year" value={vehYear} onChange={e => setVehYear(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Color" value={vehColor} onChange={e => setVehColor(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="License Plate" value={vehPlate} onChange={e => setVehPlate(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="License State" value={vehState} onChange={e => setVehState(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                </div>
                <button onClick={addVehicle} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save Vehicle</button>
              </div>
            )}

            {vehicles.map(v => (
              <div key={v.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{v.vehicle_year} {v.vehicle_make} {v.vehicle_model}</p>
                <p style={{ fontSize: 13 }}>{v.color}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>Plate: {v.license_plate} {v.license_state}</p>
              </div>
            ))}
            {vehicles.length === 0 && <p style={{ color: "var(--gray)" }}>No vehicles listed.</p>}
          </div>

        </div>
      </section>
    </>
  );
}
