"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import AutopaySection from "@/components/AutopaySection";

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
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  const [electricUsage, setElectricUsage] = useState<any[]>([]);
  const [rentToOwnPlan, setRentToOwnPlan] = useState<any>(null);
  const [nextPaymentDate, setNextPaymentDate] = useState<string | null>(null);
  const [propaneOrders, setPropaneOrders] = useState<any[]>([]);
  const [acceptOnlinePayments, setAcceptOnlinePayments] = useState(true);
  const [autopayAvailable, setAutopayAvailable] = useState(false);
  const [autopayEnabled, setAutopayEnabled] = useState(false);
  const [autopayCardLast4, setAutopayCardLast4] = useState<string | null>(null);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [activeLease, setActiveLease] = useState<any>(null);
  const [moveOutDate, setMoveOutDate] = useState("");
  const [moveOutNote, setMoveOutNote] = useState("");
  const [moveOutSubmitting, setMoveOutSubmitting] = useState(false);
  const [moveOutMessage, setMoveOutMessage] = useState("");
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
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  const [rvMake, setRvMake] = useState("");
  const [rvModel, setRvModel] = useState("");
  const [rvYear, setRvYear] = useState("");
  const [rvLengthFt, setRvLengthFt] = useState("");
  const [rvVinOrTag, setRvVinOrTag] = useState("");
  const [savingRvInfo, setSavingRvInfo] = useState(false);

  const outstandingBalance =
    payments.reduce((sum, payment) => {
      if (payment.status === "Pending" || payment.status === "Late" || payment.status === "Partial") {
        return sum + Number(payment.total_due || payment.amount || 0);
      }
      return sum;
    }, 0) + pendingInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

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

    setResidentId(residentId);
    setAutopayEnabled(!!residentData?.autopay_enabled);
    setAutopayCardLast4(residentData?.autopay_card_last4 || null);
    setRvMake(residentData?.rv_make || "");
    setRvModel(residentData?.rv_model || "");
    setRvYear(residentData?.rv_year || "");
    setRvLengthFt(residentData?.rv_length_ft ? String(residentData.rv_length_ft) : "");
    setRvVinOrTag(residentData?.rv_vin_or_tag || "");

    if (residentError || !residentData) {
      setMessage("Resident not found.");
      return;
    }
    setResident(residentData);

    fetch(`/api/portal/rent-to-own-plan?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setRentToOwnPlan(result.plan || null))
      .catch(() => setRentToOwnPlan(null));

    fetch(`/api/portal/billing-info?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setNextPaymentDate(result.nextPaymentDate || null))
      .catch(() => setNextPaymentDate(null));

    fetch(`/api/portal/propane-orders?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setPropaneOrders(result.orders || []))
      .catch(() => setPropaneOrders([]));

    const { data: feeSettings } = await supabase
      .from("company_fee_settings")
      .select("accept_online_payments, autopay_available")
      .eq("company_id", residentData.company_id)
      .maybeSingle();
    // Default to true (allow online payments) when this hasn't been
    // explicitly configured, so we never silently hide an already-working
    // Pay Now button for a company that just hasn't touched Fee Settings.
    setAcceptOnlinePayments(feeSettings ? !!feeSettings.accept_online_payments : true);
    setAutopayAvailable(!!feeSettings?.autopay_available);

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

    const { data: lease } = await supabase
      .from("resident_leases")
      .select("id, requested_move_out_date, requested_move_out_note")
      .eq("resident_id", residentId)
      .eq("status", "Active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setActiveLease(lease || null);
    setMoveOutDate(lease?.requested_move_out_date || "");
    setMoveOutNote(lease?.requested_move_out_note || "");

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

    const { data: invs } = await supabase
      .from("resident_invoices")
      .select("*")
      .eq("resident_id", residentId)
      .eq("status", "Pending")
      .order("due_date", { ascending: true });
    setPendingInvoices(invs || []);

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

  async function handleSubmitMoveOut() {
    if (!moveOutDate) {
      setMoveOutMessage("Please choose a date first.");
      return;
    }
    setMoveOutSubmitting(true);
    setMoveOutMessage("");
    try {
      const res = await fetch("/api/portal/request-move-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, moveOutDate, note: moveOutNote }),
      });
      const result = await res.json();
      if (!res.ok) {
        setMoveOutMessage(`Error: ${result.error}`);
      } else {
        setMoveOutMessage("Move-out date sent to the office.");
      }
    } catch {
      setMoveOutMessage("Something went wrong. Please try again.");
    }
    setMoveOutSubmitting(false);
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

    if (editingVehicleId) {
      const { error } = await supabase
        .from("resident_vehicles")
        .update({
          vehicle_make: vehMake.trim(),
          vehicle_model: vehModel.trim(),
          vehicle_year: vehYear.trim(),
          color: vehColor.trim(),
          license_plate: vehPlate.trim(),
          license_state: vehState.trim(),
        })
        .eq("id", editingVehicleId);

      if (error) {
        alert("Could not update vehicle: " + error.message);
        return;
      }

      setEditingVehicleId(null);
      setVehMake("");
      setVehModel("");
      setVehYear("");
      setVehColor("");
      setVehPlate("");
      setVehState("");
      loadResidentDashboard();
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

  async function deleteVehicle(vehicleId: string) {
    const confirmed = confirm("Remove this vehicle?");
    if (!confirmed) return;

    const { error } = await supabase.from("resident_vehicles").delete().eq("id", vehicleId);
    if (error) {
      alert("Could not remove vehicle: " + error.message);
      return;
    }
    loadResidentDashboard();
  }

  async function saveRvInfo() {
    setSavingRvInfo(true);
    const { error } = await supabase
      .from("resident_accounts")
      .update({
        rv_make: rvMake.trim() || null,
        rv_model: rvModel.trim() || null,
        rv_year: rvYear.trim() || null,
        rv_length_ft: rvLengthFt ? Number(rvLengthFt) : null,
        rv_vin_or_tag: rvVinOrTag.trim() || null,
      })
      .eq("id", resident.id);

    if (error) {
      alert("Could not save RV info: " + error.message);
    } else {
      alert("RV info saved.");
    }
    setSavingRvInfo(false);
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
            <button onClick={() => router.push("/residents/invoices")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🧾 Invoices</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View your monthly invoices and charges.</p>
            </button>
            <button onClick={() => router.push("/residents/payments")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>💳 Payments</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View and pay outstanding charges.</p>
            </button>
            <button onClick={() => router.push("/residents/payment-history")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📜 Payment History</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View completed payments.</p>
            </button>
            <button onClick={() => router.push("/residents/documents")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📄 Documents</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View and print your signed lease agreement.</p>
            </button>
            <button onClick={() => router.push("/residents/marketplace")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🛍️ Marketplace</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>Buy and sell with your neighbors.</p>
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
              {acceptOnlinePayments && (
              <button
                onClick={handlePayNow}
                style={{ marginTop: 12, background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
              >
                Pay Now
              </button>
              )}
            </div>
          </div>

          {rentToOwnPlan && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
                🏡 Rent-to-Own Plan {rentToOwnPlan.lot_name ? `— Lot ${rentToOwnPlan.lot_name}` : ""}
              </h2>
              <p style={{ ...label, marginBottom: 12 }}>
                ${Number(rentToOwnPlan.monthly_principal).toFixed(2)}/month toward your total purchase price
              </p>
              <div style={{ fontSize: 14, marginBottom: 6 }}>
                ${rentToOwnPlan.paid_so_far.toFixed(2)} paid of ${Number(rentToOwnPlan.total_price).toLocaleString()}
                {" — "}
                <strong>${rentToOwnPlan.remaining.toFixed(2)} remaining</strong>
              </div>
              <div style={{ ...label, marginBottom: 6 }}>
                {Math.max(0, Math.ceil(rentToOwnPlan.remaining / rentToOwnPlan.monthly_principal))} payment(s) left
              </div>
              <div style={{ width: "100%", background: "#e5e7eb", borderRadius: 999, height: 10 }}>
                <div
                  style={{
                    width: `${Math.min(100, Math.round((rentToOwnPlan.paid_so_far / rentToOwnPlan.total_price) * 100))}%`,
                    background: "#16a34a",
                    height: 10,
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          )}

          {propaneOrders.length > 0 && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>⛽ Propane Orders</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {propaneOrders.map((order) => (
                  <div
                    key={order.id}
                    style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", gap: 16, alignItems: "center" }}
                  >
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(order.qr_token)}`}
                      alt="Propane pickup QR code"
                      style={{ width: 100, height: 100, flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 700, margin: 0 }}>
                        {order.quantity} {order.unit === "gallon" ? "gallons" : "×"} {order.product_label}
                      </p>
                      <p style={{ color: "var(--gray)", fontSize: 13, margin: "2px 0" }}>
                        ${Number(order.amount_total).toFixed(2)} — paid{" "}
                        {new Date(order.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p style={{ fontSize: 12.5, margin: "4px 0", color: order.redeemed ? "#16a34a" : "#b45309", fontWeight: 700 }}>
                        {(() => {
                          const maxRedemptions = order.unit === "tank" ? Math.max(1, Math.floor(order.quantity)) : 1;
                          const count = order.redeemed_count || 0;
                          if (order.redeemed) return "✅ Fully picked up";
                          if (count > 0) return `🕓 Picked up ${count}/${maxRedemptions} — show this code to staff for the rest`;
                          return "🕓 Ready for pickup — show this code to staff";
                        })()}
                      </p>
                      <button
                        onClick={async () => {
                          await fetch("/api/portal/dismiss-propane-order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ orderId: order.id }),
                          });
                          setPropaneOrders((prev) => prev.filter((o) => o.id !== order.id));
                        }}
                        style={{ fontSize: 12, color: "var(--gray)", background: "none", border: "none", textDecoration: "underline", cursor: "pointer", padding: 0 }}
                      >
                        Remove from my portal
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {autopayAvailable && residentId && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>💳 Autopay</h2>
              <AutopaySection
                residentId={residentId}
                autopayEnabled={autopayEnabled}
                cardLast4={autopayCardLast4}
                onChange={loadResidentDashboard}
              />
            </div>
          )}

          {/* Outstanding charges list */}
          {(payments.length > 0 || pendingInvoices.length > 0) && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Outstanding Charges</h2>
              {nextPaymentDate && (
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                  Next Payment (Due Date): <strong>{nextPaymentDate}</strong>
                </p>
              )}
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
                {pendingInvoices.map(inv => (
                  <div key={inv.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <p style={{ fontWeight: 700 }}>Monthly Invoice — {inv.invoice_month}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>Rent + any recurring charges</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 900 }}>${Number(inv.total_amount || 0).toFixed(2)}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{inv.status}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1.5px solid var(--border)", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 900 }}>Total Due</span>
                <span style={{ fontWeight: 900 }}>${outstandingBalance.toFixed(2)}</span>
              </div>
              {acceptOnlinePayments && (
              <button
                onClick={handlePayNow}
                style={{ marginTop: 16, width: "100%", background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: 14, fontWeight: 700, cursor: "pointer" }}
              >
                Pay Online
              </button>
              )}
            </div>
          )}

          {/* Maintenance link */}
          <div onClick={() => router.push("/residents/maintenance")} style={{ ...card, cursor: "pointer" }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Maintenance Requests</h2>
            <p style={{ color: "var(--gray)", fontSize: 13 }}>Report issues and track maintenance progress.</p>
          </div>

          {/* Move-out request */}
          {activeLease && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🚪 Moving Out?</h2>
              <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                Let us know your planned move-out date — the office will follow up to confirm.
              </p>
              {activeLease.requested_move_out_date && (
                <p style={{ fontSize: 13, marginBottom: 12, color: "var(--black)" }}>
                  Currently requested: <strong>{activeLease.requested_move_out_date}</strong>
                </p>
              )}
              <label style={label}>Move-Out Date</label>
              <input
                type="date"
                value={moveOutDate}
                onChange={(e) => setMoveOutDate(e.target.value)}
                style={{ width: "100%", padding: 10, border: "1.5px solid var(--border)", borderRadius: 6, marginBottom: 10 }}
              />
              <label style={label}>Notes (optional)</label>
              <textarea
                value={moveOutNote}
                onChange={(e) => setMoveOutNote(e.target.value)}
                rows={2}
                style={{ width: "100%", padding: 10, border: "1.5px solid var(--border)", borderRadius: 6, marginBottom: 10 }}
              />
              <button
                onClick={handleSubmitMoveOut}
                disabled={moveOutSubmitting}
                style={{ background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "10px 16px", fontWeight: 700, cursor: "pointer", opacity: moveOutSubmitting ? 0.6 : 1 }}
              >
                {moveOutSubmitting ? "Sending..." : "Submit Move-Out Date"}
              </button>
              {moveOutMessage && <p style={{ fontSize: 13, marginTop: 8 }}>{moveOutMessage}</p>}
            </div>
          )}

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
              <button onClick={() => {
                setEditingVehicleId(null);
                setVehMake(""); setVehModel(""); setVehYear(""); setVehColor(""); setVehPlate(""); setVehState("");
                setAddingVehicle(!addingVehicle);
              }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
                <button onClick={addVehicle} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{editingVehicleId ? "Update Vehicle" : "Save Vehicle"}</button>
              </div>
            )}

            {vehicles.map(v => (
              <div key={v.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{v.vehicle_year} {v.vehicle_make} {v.vehicle_model}</p>
                <p style={{ fontSize: 13 }}>{v.color}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>Plate: {v.license_plate} {v.license_state}</p>
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      setEditingVehicleId(v.id);
                      setVehMake(v.vehicle_make || "");
                      setVehModel(v.vehicle_model || "");
                      setVehYear(v.vehicle_year || "");
                      setVehColor(v.color || "");
                      setVehPlate(v.license_plate || "");
                      setVehState(v.license_state || "");
                      setAddingVehicle(true);
                    }}
                    style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteVehicle(v.id)}
                    style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {vehicles.length === 0 && <p style={{ color: "var(--gray)" }}>No vehicles listed.</p>}
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>🚐 RV Info</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <input placeholder="RV Make" value={rvMake} onChange={e => setRvMake(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input placeholder="RV Model" value={rvModel} onChange={e => setRvModel(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input placeholder="RV Year" value={rvYear} onChange={e => setRvYear(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input placeholder="Length (ft)" type="number" value={rvLengthFt} onChange={e => setRvLengthFt(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
              <input placeholder="VIN / Tag #" value={rvVinOrTag} onChange={e => setRvVinOrTag(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }} />
            </div>
            <button
              onClick={saveRvInfo}
              disabled={savingRvInfo}
              style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: savingRvInfo ? "default" : "pointer", opacity: savingRvInfo ? 0.7 : 1 }}
            >
              {savingRvInfo ? "Saving..." : "Save RV Info"}
            </button>
          </div>

        </div>
      </section>
    </>
  );
}
