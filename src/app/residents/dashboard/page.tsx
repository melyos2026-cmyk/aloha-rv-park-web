"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import AutopaySection from "@/components/AutopaySection";

const card: React.CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };
const cardAccent: React.CSSProperties = { ...card, border: "2px solid var(--red)" };
const label = { color: "var(--gray)", fontSize: 13, marginBottom: 4 };
const bigNumber = { fontSize: 26, fontWeight: 900 };

// Aug 4: parses a "Month Year" billing label (e.g. "July 2026") into a
// sortable integer, so the resident's Electric Usage card can be ordered
// by the real billing period instead of by when admin happened to save
// it — see the note where this is used below.
const BILLING_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function billingMonthKey(label: string): number {
  const [monthName, yearStr] = (label || "").split(" ");
  const idx = BILLING_MONTH_NAMES.indexOf(monthName);
  const year = Number(yearStr);
  if (idx === -1 || !year) return -Infinity;
  return year * 12 + idx;
}

// Aug 4 (per Mely): same age calculation already used server-side for
// lease-application occupants (src/app/api/stripe-webhook/route.ts) —
// duplicated here (null-safe) since Household Occupants' age needs to be
// shown live in the UI, not just checked at payment time.
function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export default function ResidentDashboard() {
  const [resident, setResident] = useState<any>(null);
  const [occupants, setOccupants] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  // Aug 4 (per Mely): a persistent reminder so a resident who added an
  // occupant and got sidetracked (uploading an ID, etc.) doesn't lose
  // track of finishing/paying for the background check — visible from
  // the very first screen, not just tucked away in Household Occupants.
  const [pendingBgChecks, setPendingBgChecks] = useState<any[]>([]);
  const [message, setMessage] = useState("Loading...");
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<any[]>([]);
  // Line items per pending invoice (Aug 4) — e.g. "Monthly Rent $500",
  // "Wifi $35", "Electric Service $X" — fetched via the same
  // /api/portal/invoice-items route the Invoices page already uses, so the
  // dashboard's Outstanding Charges shows the real itemized breakdown
  // instead of one flat "Monthly Invoice" line.
  const [invoiceItemsByInvoice, setInvoiceItemsByInvoice] = useState<Record<string, any[]>>({});
  const [electricUsage, setElectricUsage] = useState<any[]>([]);
  const [rentToOwnPlan, setRentToOwnPlan] = useState<any>(null);
  const [nextPaymentDate, setNextPaymentDate] = useState<string | null>(null);
  const [propaneOrders, setPropaneOrders] = useState<any[]>([]);
  const [acceptOnlinePayments, setAcceptOnlinePayments] = useState(true);
  const [autopayAvailable, setAutopayAvailable] = useState(false);
  const [moveOutThresholdDays, setMoveOutThresholdDays] = useState(15);
  const [autopayEnabled, setAutopayEnabled] = useState(false);
  const [autopayCardLast4, setAutopayCardLast4] = useState<string | null>(null);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [activeLease, setActiveLease] = useState<any>(null);
  const [showMoveOutModal, setShowMoveOutModal] = useState(false);
  const [moveOutDate, setMoveOutDate] = useState("");
  const [moveOutNote, setMoveOutNote] = useState("");
  const [moveOutSubmitting, setMoveOutSubmitting] = useState(false);
  const [moveOutMessage, setMoveOutMessage] = useState("");
  const router = useRouter();

  // Split into two independent edit toggles (Aug 4) so clicking Edit on
  // Resident Information no longer also opens/shows Emergency Contact's
  // fields, and vice versa — previously both Edit buttons shared one
  // combined editingInfo form.
  const [editingResidentInfo, setEditingResidentInfo] = useState(false);
  const [editingEmergencyContact, setEditingEmergencyContact] = useState(false);
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formEmergencyName, setFormEmergencyName] = useState("");
  const [formEmergencyPhone, setFormEmergencyPhone] = useState("");
  const [formEmergencyRelationship, setFormEmergencyRelationship] = useState("");
  const [emergencyContactMessage, setEmergencyContactMessage] = useState("");

  const [addingOccupant, setAddingOccupant] = useState(false);
  const [occType, setOccType] = useState("household");
  const [occFullName, setOccFullName] = useState("");
  const [occRelationship, setOccRelationship] = useState("");
  const [occPhone, setOccPhone] = useState("");
  const [occEmail, setOccEmail] = useState("");
  const [occStayStart, setOccStayStart] = useState("");
  const [occStayEnd, setOccStayEnd] = useState("");
  // Household Occupants — Date of Birth (Aug 4, per Mely): required so the
  // system can tell whether an occupant is 18+ and therefore needs a
  // background check before move-in is compliant (skipping it risks lease
  // termination, per Mely). Visitors don't need this.
  const [occDateOfBirth, setOccDateOfBirth] = useState("");
  const [editingVisitorId, setEditingVisitorId] = useState<string | null>(null);

  const [addingVehicle, setAddingVehicle] = useState(false);
  const [vehMake, setVehMake] = useState("");
  const [vehModel, setVehModel] = useState("");
  const [vehYear, setVehYear] = useState("");
  const [vehColor, setVehColor] = useState("");
  const [vehPlate, setVehPlate] = useState("");
  const [vehState, setVehState] = useState("");
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);

  const [rvType, setRvType] = useState("RV");
  const [rvMake, setRvMake] = useState("");
  const [rvModel, setRvModel] = useState("");
  const [rvYear, setRvYear] = useState("");
  const [rvLengthFt, setRvLengthFt] = useState("");
  const [rvWidthFt, setRvWidthFt] = useState("");
  const [rvVinOrTag, setRvVinOrTag] = useState("");
  const [savingRvInfo, setSavingRvInfo] = useState(false);
  // View/edit toggle for RV Info (Aug 3, per Mely's feedback) — shows saved
  // info as plain text with an Edit button, instead of always-open input
  // boxes with no clear "saved" state.
  const [editingRvInfo, setEditingRvInfo] = useState(false);
  // Inline status messages (Aug 2 debugging) — shown in the page itself
  // instead of relying only on window.alert(), since alert() can be
  // silently suppressed by some mobile browsers/in-app webviews, which
  // made earlier failures look like "nothing happened."
  const [residentInfoMessage, setResidentInfoMessage] = useState("");
  const [occupantMessage, setOccupantMessage] = useState("");
  const [vehicleMessage, setVehicleMessage] = useState("");
  const [rvMessage, setRvMessage] = useState("");
  const [editingPets, setEditingPets] = useState(false);
  const [petsAllowedInput, setPetsAllowedInput] = useState(false);
  const [petsCountInput, setPetsCountInput] = useState("");
  const [petsTypesInput, setPetsTypesInput] = useState("");
  const [petsMessage, setPetsMessage] = useState("");

  // Aug 4: resident_payments (the legacy billing table) was fully unified
  // into resident_invoices — /api/create-checkout-session only ever charges
  // pending invoices already, but this dashboard was still fetching and
  // adding the old resident_payments rows on top, making the same charge
  // appear twice (once as a leftover "Invoice" row, once as the real
  // "Monthly Invoice") and doubling the displayed Total Due. Invoices are
  // now the single source of truth here, matching what's actually charged.
  const outstandingBalance = pendingInvoices.reduce(
    (sum, inv) => sum + Number(inv.total_amount || 0),
    0
  );

  useEffect(() => {
    loadResidentDashboard();
  }, []);

  // Aug 4 (per Mely): arriving via /residents/dashboard#household-occupants
  // (e.g. from the "+ Add Household Occupant" link on the Background
  // Checks page) opens the Add form and scrolls straight to it, instead
  // of leaving the resident to hunt for the section themselves.
  useEffect(() => {
    if (window.location.hash === "#household-occupants") {
      setOccType("household");
      setAddingOccupant(true);
      setTimeout(() => {
        document.getElementById("household-occupants")?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, []);

  async function loadResidentDashboard() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      router.push("/login");
      return;
    }

    const { resident: residentData, error: profileError } = await fetch(
      `/api/portal/resident-profile?residentId=${residentId}`
    )
      .then((res) => res.json())
      .catch(() => ({ resident: null, error: "Failed to load profile." }));

    setResidentId(residentId);
    setAutopayEnabled(!!residentData?.autopay_enabled);
    setAutopayCardLast4(residentData?.autopay_card_last4 || null);
    setRvType(residentData?.rv_type || "RV");
    setRvMake(residentData?.rv_make || "");
    setRvModel(residentData?.rv_model || "");
    setRvYear(residentData?.rv_year || "");
    setRvLengthFt(residentData?.rv_length_ft ? String(residentData.rv_length_ft) : "");
    setRvWidthFt(residentData?.rv_width_ft ? String(residentData.rv_width_ft) : "");
    setRvVinOrTag(residentData?.rv_vin_or_tag || "");
    setEditingRvInfo(!residentData?.rv_make && !residentData?.rv_model && !residentData?.rv_vin_or_tag);

    if (profileError || !residentData) {
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

    // FOUND (Aug 3): company_fee_settings was read directly with the anon
    // key here, which is very likely blocked by RLS the same way
    // resident_occupants/resident_vehicles were (commit 6730b12) — that
    // would silently make autopayAvailable always false, hiding the
    // Autopay section regardless of the real setting. Moved to a
    // session-guarded server route (Service Role Key).
    const feeSettingsData = await fetch(`/api/portal/fee-settings?residentId=${residentId}`)
      .then((r) => r.json())
      .catch(() => null);
    setAcceptOnlinePayments(feeSettingsData?.acceptOnlinePayments ?? true);
    setAutopayAvailable(!!feeSettingsData?.autopayAvailable);
    setMoveOutThresholdDays(feeSettingsData?.moveOutThresholdDays ?? 15);

    const pendingBgData = await fetch(`/api/portal/pending-background-checks?residentId=${residentId}`)
      .then((r) => r.json())
      .catch(() => null);
    setPendingBgChecks(pendingBgData?.pending || []);

    // FOUND (Aug 11): this was the last direct client-side Supabase read
    // left in the dashboard — moved server-side behind the session cookie,
    // same pattern as occupants/vehicles below.
    const electricRes = await fetch(`/api/portal/electric-readings?residentId=${residentId}`)
      .then((r) => r.json())
      .catch(() => null);
    const electricData = electricRes?.readings || [];
    // BUG FIX (Aug 4): ordering by created_at (save time) instead of the
    // actual billing period broke once admin started backfilling past
    // months — a "July 2026" reading saved AFTER an "August 2026" one has
    // a LATER created_at, so it wrongly showed as "the current reading"
    // here. Re-sort by the real month/year the reading is FOR so the most
    // recent BILLING PERIOD is always shown first, regardless of the
    // order things were entered in admin.
    const sortedElectric = [...(electricData || [])].sort(
      (a, b) => billingMonthKey(b.billing_month) - billingMonthKey(a.billing_month)
    );
    setElectricUsage(sortedElectric);

    const res = await fetch(`/api/portal/active-lease?residentId=${residentId}`);
    const result = await res.json();
    const lease = result.lease;
    setActiveLease(lease || null);
    setMoveOutDate(lease?.requested_move_out_date || "");
    setMoveOutNote(lease?.requested_move_out_note || "");

    // FOUND THE ROOT CAUSE (Aug 3): resident_occupants and resident_vehicles
    // both have a deny-all RLS policy, so these direct anon-key reads
    // always silently returned zero rows — even right after a successful
    // save via the new session-guarded routes — making saves look like
    // they never happened. Moved to a server route (Service Role Key).
    const occVehData = await fetch(
      `/api/portal/occupants-vehicles?residentId=${residentId}`
    )
      .then((r) => r.json())
      .catch(() => null);
    setOccupants(occVehData?.occupants || []);
    setVehicles(occVehData?.vehicles || []);

    const { invoices: allInvoices } = await fetch(`/api/portal/invoices?residentId=${residentId}`)
      .then((res) => res.json())
      .catch(() => ({ invoices: [] }));
    const invs = (allInvoices || [])
      .filter((inv: any) => inv.status === "Pending")
      .sort((a: any, b: any) => (a.due_date || "").localeCompare(b.due_date || ""));
    setPendingInvoices(invs || []);

    // Fetch each pending invoice's itemized line items (Rent, Wifi,
    // Electric, Maintenance, etc.) via the same route the Invoices page
    // uses, so Outstanding Charges can show the real breakdown per charge.
    if (invs && invs.length > 0) {
      const itemsEntries = await Promise.all(
        invs.map(async (inv: any) => {
          const res = await fetch(
            `/api/portal/invoice-items?invoiceId=${inv.id}&residentId=${residentId}`
          )
            .then((r) => r.json())
            .catch(() => ({ items: [] }));
          return [inv.id, res.items || []] as [string, any[]];
        })
      );
      setInvoiceItemsByInvoice(Object.fromEntries(itemsEntries));
    } else {
      setInvoiceItemsByInvoice({});
    }

    const { data: anns } = await supabase
      .from("announcements")
      .select("*")
      .eq("company_id", residentData.company_id)
      .is("archived_at", null)
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
    fetch("/api/portal-logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  // notifyAdmin was removed (Aug 2) — every call site was migrated to a
  // session-guarded server route (/api/portal/save-resident-info,
  // save-occupant, delete-occupant, save-vehicle) that inserts its own
  // resident_update_notifications row server-side instead.

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
        setMoveOutMessage("Submitted ✓");
        setActiveLease((prev: any) => ({
          ...prev,
          requested_move_out_date: moveOutDate,
          requested_move_out_note: moveOutNote,
        }));
      }
    } catch {
      setMoveOutMessage("Something went wrong. Please try again.");
    }
    setMoveOutSubmitting(false);
  }

  async function handleCancelMoveOut() {
    if (!confirm("Cancel your move-out request? You can submit a new date afterward.")) return;
    setMoveOutSubmitting(true);
    setMoveOutMessage("");
    try {
      const res = await fetch("/api/portal/cancel-move-out-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId }),
      });
      const result = await res.json();
      if (!res.ok) {
        setMoveOutMessage(`Error: ${result.error}`);
      } else {
        setActiveLease((prev: any) => ({
          ...prev,
          requested_move_out_date: null,
          requested_move_out_note: null,
        }));
        setMoveOutDate("");
        setMoveOutNote("");
        setMoveOutMessage("");
      }
    } catch {
      setMoveOutMessage("Something went wrong. Please try again.");
    }
    setMoveOutSubmitting(false);
  }

  function openEditResidentInfo() {
    setFormPhone(resident.phone || "");
    setFormEmail(resident.email || "");
    setResidentInfoMessage("");
    setEditingResidentInfo(true);
  }

  function openEditEmergencyContact() {
    setFormEmergencyName(resident.emergency_contact_name || "");
    setFormEmergencyPhone(resident.emergency_contact_phone || "");
    setFormEmergencyRelationship(resident.emergency_contact_relationship || "");
    setEmergencyContactMessage("");
    setEditingEmergencyContact(true);
  }

  // SECURITY (Aug 2): moved from a direct client-side Supabase update to a
  // session-guarded server route — see /api/portal/save-resident-info.
  // Uses an inline message instead of alert() (Aug 2 debugging) — alert()
  // can be silently suppressed by some mobile browsers/in-app webviews,
  // which made earlier failures look like "nothing happened."
  // Split (Aug 4) into two independent saves — each only sends its own
  // section's fields; the route already fills in the other side's current
  // values when a field is omitted, so neither save can clobber the other.
  async function saveResidentInfo() {
    setResidentInfoMessage("");
    try {
      const res = await fetch("/api/portal/save-resident-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          phone: formPhone.trim(),
          email: formEmail.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setResidentInfoMessage("Could not save changes: " + (result?.error || res.status));
        return;
      }

      setEditingResidentInfo(false);
      loadResidentDashboard();
    } catch (err: any) {
      setResidentInfoMessage("Could not save changes (unexpected error): " + (err?.message || err));
    }
  }

  // Aug 11 (per Mely): the only self-editable field in the otherwise
  // read-only "Parking & Pets" card — residents get new pets over time and
  // should be able to update this themselves. Notifies the admin (see
  // /api/portal/save-pets).
  async function savePets() {
    setPetsMessage("");
    try {
      const res = await fetch("/api/portal/save-pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          petsAllowed: petsAllowedInput,
          petsCount: petsCountInput,
          petsTypes: petsTypesInput,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setPetsMessage("Could not save pets: " + (result?.error || res.status));
        return;
      }

      setEditingPets(false);
      loadResidentDashboard();
    } catch (err: any) {
      setPetsMessage("Could not save pets (unexpected error): " + (err?.message || err));
    }
  }

  async function saveEmergencyContact() {
    setEmergencyContactMessage("");
    try {
      const res = await fetch("/api/portal/save-resident-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          emergencyContactName: formEmergencyName.trim(),
          emergencyContactPhone: formEmergencyPhone.trim(),
          emergencyContactRelationship: formEmergencyRelationship.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setEmergencyContactMessage("Could not save changes: " + (result?.error || res.status));
        return;
      }

      setEditingEmergencyContact(false);
      loadResidentDashboard();
    } catch (err: any) {
      setEmergencyContactMessage("Could not save changes (unexpected error): " + (err?.message || err));
    }
  }

  async function addOccupant() {
    setOccupantMessage("");
    if (!occFullName.trim()) {
      setOccupantMessage("Please enter a full name.");
      return;
    }
    // Mely asked (Aug 2) that Stay Start/End Date be required before a
    // visitor can be saved, not just optional.
    if (occType === "visitor" && (!occStayStart || !occStayEnd)) {
      setOccupantMessage("Please enter both a Stay Start Date and Stay End Date.");
      return;
    }
    // Aug 4 (per Mely): Date of Birth is required for Household Occupants
    // — it's how the system knows whether a background check is legally
    // required (18+) before move-in is compliant.
    if (occType === "household" && !occDateOfBirth) {
      setOccupantMessage("Please enter this person's Date of Birth.");
      return;
    }

    // SECURITY (Aug 2): moved from direct client-side Supabase
    // insert/update to a session-guarded server route — see
    // /api/portal/save-occupant. Notification-sending behavior (which
    // update_type fires) is preserved server-side, unchanged.
    // Inline message instead of alert() (Aug 2 debugging) — see note in
    // saveResidentInfo.
    try {
      const res = await fetch("/api/portal/save-occupant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          occupantId: editingVisitorId || undefined,
          occupantType: occType,
          fullName: occFullName.trim(),
          relationship: occRelationship.trim(),
          phone: occPhone.trim(),
          email: occEmail.trim().toLowerCase(),
          stayStart: occStayStart || null,
          stayEnd: occStayEnd || null,
          dateOfBirth: occType === "household" ? occDateOfBirth || null : null,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setOccupantMessage((editingVisitorId ? "Could not update visitor: " : "Could not add: ") + (result?.error || res.status));
        return;
      }

      setOccFullName("");
      setOccRelationship("");
      setOccPhone("");
      setOccEmail("");
      setOccStayStart("");
      setOccStayEnd("");
      setOccDateOfBirth("");
      setOccType("household");
      setEditingVisitorId(null);
      setAddingOccupant(false);
      loadResidentDashboard();
    } catch (err: any) {
      setOccupantMessage("Could not save (unexpected error): " + (err?.message || err));
    }
  }

  // Despite the name (kept to avoid touching every call site), this now
  // works for both Visitors and Household Occupants — Aug 3, per Mely's
  // request to let residents remove/edit a household occupant who moved
  // out, not just contact park management.
  function startEditVisitor(person: any) {
    setOccupantMessage("");
    setEditingVisitorId(person.id);
    setOccFullName(person.full_name || "");
    setOccRelationship(person.relationship || "");
    setOccPhone(person.phone || "");
    setOccEmail(person.email || "");
    setOccStayStart(person.stay_start_date || "");
    setOccStayEnd(person.stay_end_date || "");
    setOccDateOfBirth(person.date_of_birth || "");
    setOccType(person.occupant_type === "visitor" ? "visitor" : "household");
    setAddingOccupant(true);
  }

  async function deleteVisitor(id: string) {
    if (!confirm("Remove this person?")) return;
    setOccupantMessage("");

    // SECURITY (Aug 2): moved from a direct client-side Supabase delete to
    // a session-guarded server route — see /api/portal/delete-occupant.
    try {
      const res = await fetch("/api/portal/delete-occupant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: resident.id, occupantId: id }),
      });
      const result = await res.json();
      if (!res.ok) {
        setOccupantMessage("Could not remove: " + (result?.error || res.status));
        return;
      }

      loadResidentDashboard();
    } catch (err: any) {
      setOccupantMessage("Could not remove (unexpected error): " + (err?.message || err));
    }
  }

  async function addVehicle() {
    setVehicleMessage("");
    if (!vehPlate.trim()) {
      setVehicleMessage("Please enter a license plate.");
      return;
    }

    // SECURITY (Aug 2): moved from direct client-side Supabase
    // insert/update to a session-guarded server route — see
    // /api/portal/save-vehicle. Behavior preserved: updates don't fire a
    // notification, new vehicles do (handled server-side now).
    // Inline message instead of alert() (Aug 2 debugging).
    try {
      const res = await fetch("/api/portal/save-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          vehicleId: editingVehicleId || undefined,
          make: vehMake.trim(),
          model: vehModel.trim(),
          year: vehYear.trim(),
          color: vehColor.trim(),
          plate: vehPlate.trim(),
          state: vehState.trim(),
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setVehicleMessage((editingVehicleId ? "Could not update vehicle: " : "Could not add vehicle: ") + (result?.error || res.status));
        return;
      }

      if (editingVehicleId) {
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

      setVehMake("");
      setVehModel("");
      setVehYear("");
      setVehColor("");
      setVehPlate("");
      setVehState("");
      setAddingVehicle(false);
      loadResidentDashboard();
    } catch (err: any) {
      setVehicleMessage("Could not save vehicle (unexpected error): " + (err?.message || err));
    }
  }

  async function deleteVehicle(vehicleId: string) {
    const confirmed = confirm("Remove this vehicle?");
    if (!confirmed) return;
    setVehicleMessage("");

    // SECURITY (Aug 2): moved from a direct client-side Supabase delete to
    // a session-guarded server route — see /api/portal/delete-vehicle.
    try {
      const res = await fetch("/api/portal/delete-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: resident.id, vehicleId }),
      });
      const result = await res.json();
      if (!res.ok) {
        setVehicleMessage("Could not remove vehicle: " + (result?.error || res.status));
        return;
      }
      loadResidentDashboard();
    } catch (err: any) {
      setVehicleMessage("Could not remove vehicle (unexpected error): " + (err?.message || err));
    }
  }

  async function saveRvInfo() {
    setSavingRvInfo(true);
    setRvMessage("");
    // SECURITY (Aug 2): moved from a direct client-side Supabase update to
    // a session-guarded server route — see /api/portal/save-rv-info.
    try {
      const res = await fetch("/api/portal/save-rv-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          rvType,
          rvMake: rvMake.trim(),
          rvModel: rvModel.trim(),
          rvYear: rvYear.trim(),
          rvLengthFt,
          rvWidthFt,
          rvVinOrTag: rvVinOrTag.trim(),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setRvMessage("Could not save RV info: " + (result?.error || res.status));
      } else {
        setRvMessage("RV info saved.");
        setEditingRvInfo(false);
      }
    } catch (err: any) {
      setRvMessage("Could not save RV info (unexpected error): " + (err?.message || err));
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
            <p style={{ color: "#000000", fontSize: 14 }}>{resident.rv_lots?.lot_name ? `Lot ${resident.rv_lots.lot_name}` : (resident.companies?.company_name || "")}</p>
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
            {activeLease && (
              <button
                onClick={() => setShowMoveOutModal(true)}
                style={{ ...card, textAlign: "left", cursor: "pointer" }}
              >
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🚪 Moving Out?</h2>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>Let us know your planned move-out date.</p>
              </button>
            )}
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

          {/* Background Check reminder (Aug 4, per Mely) — persistent
              banner so a resident who added an occupant doesn't lose
              track of finishing/paying for the required check. */}
          {pendingBgChecks.length > 0 && (
            <div style={{ ...card, border: "2px solid #fb923c", background: "#fff7ed" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6, color: "#9a3412" }}>⚠️ Background Check Needed</h2>
              <p style={{ fontSize: 13, color: "#9a3412", marginBottom: 12 }}>
                {pendingBgChecks.length === 1
                  ? "1 household occupant still needs a background check paid for and started."
                  : `${pendingBgChecks.length} household occupants still need a background check paid for and started.`}
              </p>
              <button
                onClick={() => router.push("/residents/background-checks")}
                style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                Continue to Background Check(s)
              </button>
            </div>
          )}

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

          {/* Resident + Emergency info — each card edits independently (Aug 4):
              opening one no longer shows or affects the other's fields.
              Responsive grid (Aug 4): stacks to a single column on narrow
              (mobile) screens instead of squeezing both cards side by side
              — auto-fit/minmax handles this in pure CSS, no JS/media-query
              needed, since Tailwind's responsive utility classes don't
              generate CSS in production on this app. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {!editingResidentInfo ? (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>Resident Information</h2>
                  <button onClick={openEditResidentInfo} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                </div>
                <p><strong>Email:</strong> {resident.email || "No email"}</p>
                <p style={{ marginTop: 8 }}><strong>Phone:</strong> {resident.phone || "No phone"}</p>
              </div>
            ) : (
              <div style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Edit Resident Information</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Email</label>
                    <input placeholder="Email" value={formEmail} onChange={e => setFormEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Phone</label>
                    <input placeholder="Phone" value={formPhone} onChange={e => setFormPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>The park office is notified whenever you update this information.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={saveResidentInfo} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save</button>
                  <button onClick={() => setEditingResidentInfo(false)} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  {residentInfoMessage && <p style={{ fontSize: 13, color: residentInfoMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>{residentInfoMessage}</p>}
                </div>
              </div>
            )}

            {!editingEmergencyContact ? (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>Emergency Contact</h2>
                  <button onClick={openEditEmergencyContact} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                </div>
                <p><strong>Name:</strong> {resident.emergency_contact_name || "None"}</p>
                <p><strong>Phone:</strong> {resident.emergency_contact_phone || "None"}</p>
                <p><strong>Relationship:</strong> {resident.emergency_contact_relationship || "None"}</p>
              </div>
            ) : (
              <div style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Edit Emergency Contact</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Name</label>
                    <input placeholder="Name" value={formEmergencyName} onChange={e => setFormEmergencyName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Phone</label>
                    <input placeholder="Phone" value={formEmergencyPhone} onChange={e => setFormEmergencyPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Relationship</label>
                    <input placeholder="e.g. Mother, Spouse, Friend" value={formEmergencyRelationship} onChange={e => setFormEmergencyRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>The park office is notified whenever you update this information.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={saveEmergencyContact} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save</button>
                  <button onClick={() => setEditingEmergencyContact(false)} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  {emergencyContactMessage && <p style={{ fontSize: 13, color: emergencyContactMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>{emergencyContactMessage}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Rent / Balance */}
          <style jsx>{`
            @media (max-width: 640px) {
              .rent-balance-grid {
                grid-template-columns: 1fr !important;
              }
              .autopay-card {
                order: 2;
              }
              .balance-card {
                order: 1;
              }
            }
          `}</style>
          <div className="rent-balance-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {autopayAvailable && residentId ? (
              <div className="autopay-card" style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>💳 Autopay</h2>
                <AutopaySection
                  residentId={residentId}
                  autopayEnabled={autopayEnabled}
                  cardLast4={autopayCardLast4}
                  onChange={loadResidentDashboard}
                />
              </div>
            ) : (
              <div className="autopay-card" style={card}>
                <p style={label}>Rent Amount</p>
                <p style={bigNumber}>${resident.rent_amount}</p>
              </div>
            )}
            <div className="balance-card" style={cardAccent}>
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
                            body: JSON.stringify({ orderId: order.id, residentId }),
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

          {/* Outstanding charges list — itemized per invoice (Aug 4).
              resident_payments (legacy, caused the "$235 Invoice" +
              "$235 Monthly Invoice" duplicate) is no longer shown here at
              all; resident_invoices + resident_invoice_items is the single
              source of truth, same as the Invoices page and what's
              actually charged via Pay Online. */}
          {pendingInvoices.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Outstanding Charges</h2>
              {nextPaymentDate && (
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                  Next Payment (Due Date): <strong>{nextPaymentDate}</strong>
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {pendingInvoices.map(inv => {
                  const items = invoiceItemsByInvoice[inv.id] || [];
                  return (
                    <div key={inv.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12 }}>
                      <p style={{ fontWeight: 700, marginBottom: 8 }}>Invoice — {inv.invoice_month}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.length > 0 ? (
                          items.map(item => (
                            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                              <span style={{ color: "var(--gray)" }}>{item.description || item.charge_type || "Charge"}</span>
                              <span style={{ fontWeight: 700 }}>${Number(item.amount || 0).toFixed(2)}</span>
                            </div>
                          ))
                        ) : (
                          <p style={{ color: "var(--gray)", fontSize: 13 }}>Rent + any recurring charges</p>
                        )}
                      </div>
                      <div style={{ borderTop: "1.5px solid var(--border)", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700 }}>Invoice Total</span>
                        <span style={{ fontWeight: 900 }}>${Number(inv.total_amount || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })}
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
          {activeLease && showMoveOutModal && (
            <div
              onClick={() => setShowMoveOutModal(false)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div
                id="move-out-request"
                onClick={(e) => e.stopPropagation()}
                style={{ ...card, maxWidth: 420, width: "100%", position: "relative" }}
              >
                <button
                  onClick={() => setShowMoveOutModal(false)}
                  style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--gray)" }}
                  aria-label="Close"
                >
                  ✕
                </button>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🚪 Moving Out?</h2>
              <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 8 }}>
                Please give us at least <strong>{moveOutThresholdDays} days</strong> notice.
              </p>
              <p style={{ color: "#b45309", fontSize: 13, marginBottom: 12, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                Before moving out, your outstanding balance must be $0.
              </p>
              {activeLease.requested_move_out_date ? (
                <>
                  <p style={{ fontSize: 14, marginBottom: 12, color: "var(--black)" }}>
                    Requested move-out date: <strong>{activeLease.requested_move_out_date}</strong>
                    {" "}<span style={{ color: "#16a34a", fontWeight: 700 }}>Submitted ✓</span>
                  </p>
                  <p style={{ color: "#b45309", fontSize: 13, marginBottom: 12, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                    Please check your email — the office will confirm your move-out date there once approved.
                  </p>
                  <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                    Changed your mind, or need a different date? Cancel below, then submit a new one.
                  </p>
                  <button
                    onClick={handleCancelMoveOut}
                    disabled={moveOutSubmitting}
                    style={{ background: "#fff", color: "#dc2626", border: "1.5px solid #dc2626", borderRadius: 6, padding: "10px 16px", fontWeight: 700, cursor: "pointer", opacity: moveOutSubmitting ? 0.6 : 1 }}
                  >
                    {moveOutSubmitting ? "Cancelling..." : "Cancel Request"}
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
              {moveOutMessage && (
                <p style={{ fontSize: 13, marginTop: 8, color: moveOutMessage === "Submitted ✓" ? "#16a34a" : "var(--black)", fontWeight: moveOutMessage === "Submitted ✓" ? 700 : 400 }}>
                  {moveOutMessage}
                </p>
              )}
              </div>
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
                <div><p style={label}>This Month's Usage</p><p style={bigNumber}>{electricUsage[0]?.current_reading || 0} kWh</p></div>
                <div><p style={label}>Last Month's Usage</p><p style={bigNumber}>{electricUsage[0]?.previous_reading || 0} kWh</p></div>
                <div><p style={label}>Days of Service</p><p style={bigNumber}>{electricUsage[0]?.days_of_service ?? "N/A"}</p></div>
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

          {/* Household Occupants */}
          <div id="household-occupants" style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>Household Occupants</h2>
              <button onClick={() => { setOccType("household"); setEditingVisitorId(null); setOccFullName(""); setOccRelationship(""); setOccPhone(""); setOccEmail(""); setOccDateOfBirth(""); setAddingOccupant(!addingOccupant || occType !== "household"); }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingOccupant && occType === "household" ? "Cancel" : "+ Add"}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--gray)", marginBottom: 12 }}>People living here permanently. Anyone 18 or older requires a background check.</p>

            {addingOccupant && occType === "household" && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder="Full Name" value={occFullName} onChange={e => setOccFullName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Relationship" value={occRelationship} onChange={e => setOccRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Phone" value={occPhone} onChange={e => setOccPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Email" value={occEmail} onChange={e => setOccEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Date of Birth (required)</label>
                    <input type="date" value={occDateOfBirth} onChange={e => setOccDateOfBirth(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {editingVisitorId ? "Update Occupant" : "Save"}
                </button>
                {occupantMessage && occType === "household" && <p style={{ fontSize: 13, marginTop: 8, color: occupantMessage.startsWith("Could not") || occupantMessage.startsWith("Please") ? "#dc2626" : "#16a34a" }}>{occupantMessage}</p>}
              </div>
            )}

            {occupants.filter(p => p.occupant_type !== "visitor").map(person => {
              const age = calculateAge(person.date_of_birth);
              const needsBackgroundCheck = age !== null && age >= 18;
              const bgStatus = person.background_check_status;
              const bgDone = bgStatus === "Passed" || bgStatus === "in_progress" || bgStatus === "invitation_sent" || bgStatus === "Needs Review";
              return (
                <div key={person.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                  <p style={{ fontWeight: 700 }}>{person.full_name}</p>
                  <p style={{ fontSize: 13 }}>{person.relationship}</p>
                  <p style={{ color: "var(--gray)", fontSize: 13 }}>{person.phone} {person.email}</p>
                  {age !== null && <p style={{ color: "var(--gray)", fontSize: 12 }}>Age: {age}</p>}
                  <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={() => startEditVisitor(person)} style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Edit</button>
                    <button onClick={() => deleteVisitor(person.id)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Remove</button>
                  </div>
                  {needsBackgroundCheck && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: bgDone ? "#f0fdf4" : "#fff7ed", border: bgDone ? "1px solid #bbf7d0" : "1px solid #fed7aa" }}>
                      {bgDone ? (
                        <p style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>
                          Background check: {bgStatus === "Passed" ? "Passed" : bgStatus === "Needs Review" ? "Needs Review" : "In progress"}
                        </p>
                      ) : !person.has_id_uploaded ? (
                        // Aug 4 (per Mely): step 1 only — don't show
                        // "Proceed with Background Check" until the ID is
                        // actually uploaded, so the resident isn't
                        // confused into thinking they can skip ahead.
                        <>
                          <p style={{ fontSize: 12, color: "#9a3412", fontWeight: 700, marginBottom: 6 }}>
                            This person is 18 or older — a background check is required before move-in is compliant.
                          </p>
                          <p style={{ fontSize: 12, color: "#9a3412", marginBottom: 8 }}>
                            Please upload a photo ID in Documents, then proceed with the background check.
                          </p>
                          <button onClick={() => router.push(`/residents/documents?forOccupant=${person.id}`)} style={{ background: "#fff", border: "1.5px solid #9a3412", color: "#9a3412", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            Upload ID
                          </button>
                        </>
                      ) : (
                        // Step 2 — ID is on file, now they can proceed.
                        <>
                          <p style={{ fontSize: 12, color: "#9a3412", fontWeight: 700, marginBottom: 8 }}>
                            ID received. Now proceed with the background check.
                          </p>
                          <button onClick={() => router.push("/residents/background-checks")} style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            Proceed with Background Check
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Stay Start Date (required)</label>
                    <input type="date" value={occStayStart} onChange={e => setOccStayStart(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>Stay End Date (required)</label>
                    <input type="date" value={occStayEnd} onChange={e => setOccStayEnd(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {editingVisitorId ? "Update Visitor" : "Save Visitor"}
                </button>
                {occupantMessage && occType === "visitor" && <p style={{ fontSize: 13, marginTop: 8, color: occupantMessage.startsWith("Could not") || occupantMessage.startsWith("Please") ? "#dc2626" : "#16a34a" }}>{occupantMessage}</p>}
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
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button onClick={() => startEditVisitor(person)} style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Edit</button>
                  <button onClick={() => deleteVisitor(person.id)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Remove</button>
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
                {vehicleMessage && <p style={{ fontSize: 13, marginTop: 8, color: vehicleMessage.startsWith("Could not") || vehicleMessage.startsWith("Please") ? "#dc2626" : "#16a34a" }}>{vehicleMessage}</p>}
              </div>
            )}

            {vehicles.map(v => (
              <div key={v.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{v.vehicle_year} {v.vehicle_make} {v.vehicle_model}</p>
                <p style={{ fontSize: 13 }}>{v.color}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>Plate: {v.license_plate} {v.license_state}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>Parking Sticker ID#: {v.parking_sticker_id || "Not yet assigned"}</p>
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

          {/* Parking & Pets — Aug 11 (per Mely): Pets is the one field the
              resident can self-edit (they get new pets over time); every
              other value here — parking, sticker IDs, clickers, mailbox
              keys — stays admin-only, set from Resident Accounts / the
              lease application, never editable from the portal. */}
          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>🅿️ Parking &amp; Pets</h2>
            </div>

            <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
              <div>
                <strong>Parking:</strong>{" "}
                {resident?.parking_provided
                  ? `${resident?.parking_spaces || "Designated"} space(s), ${
                      resident?.parking_free ? "no additional cost" : `$${Number(resident?.parking_cost || 0).toFixed(2)}`
                    }`
                  : "Not provided"}
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>Pets:</strong>
                  {!editingPets && (
                    <button
                      onClick={() => {
                        setPetsAllowedInput(!!resident?.pets_allowed);
                        setPetsCountInput(resident?.pets_count != null ? String(resident.pets_count) : "");
                        setPetsTypesInput(resident?.pets_types || "");
                        setPetsMessage("");
                        setEditingPets(true);
                      }}
                      style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      Edit
                    </button>
                  )}
                </div>

                {editingPets ? (
                  <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={petsAllowedInput}
                        onChange={(e) => setPetsAllowedInput(e.target.checked)}
                      />
                      I have pet(s)
                    </label>
                    {petsAllowedInput && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                        <input
                          placeholder="# of Pets"
                          type="number"
                          min="0"
                          value={petsCountInput}
                          onChange={(e) => setPetsCountInput(e.target.value)}
                          style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }}
                        />
                        <input
                          placeholder="Pet Type(s) — e.g. 1 dog, 1 cat"
                          value={petsTypesInput}
                          onChange={(e) => setPetsTypesInput(e.target.value)}
                          style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }}
                        />
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={savePets}
                        style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingPets(false); setPetsMessage(""); }}
                        style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                    {petsMessage && (
                      <p style={{ fontSize: 13, marginTop: 8, color: petsMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>
                        {petsMessage}
                      </p>
                    )}
                  </div>
                ) : (
                  <span>
                    {" "}
                    {resident?.pets_allowed
                      ? `${resident?.pets_count || 0} pet(s)${resident?.pets_types ? ` (${resident.pets_types})` : ""}`
                      : "Not permitted"}
                  </span>
                )}
              </div>

              <div>
                <strong>Parking Sticker ID#(s):</strong>{" "}
                {vehicles.length === 0
                  ? "No vehicles on file"
                  : vehicles.map((v) => v.parking_sticker_id || "Not yet assigned").join(", ")}
              </div>

              <div>
                <strong>Gate Access Clickers Issued:</strong> {resident?.gate_clickers_count ?? 0}
              </div>

              <div>
                <strong>Mailbox Keys Issued:</strong> {resident?.mailbox_keys_count ?? 0}
              </div>
            </div>

            <p style={{ color: "var(--gray)", fontSize: 12, marginTop: 12 }}>
              Lost or damaged items may be subject to a replacement fee — contact the office for details.
            </p>
          </div>

          <div style={{ ...card, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>🏠 Home/Unit Info</h2>
              {!editingRvInfo && (
                <button
                  onClick={() => { setEditingRvInfo(true); setRvMessage(""); }}
                  style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Edit
                </button>
              )}
            </div>

            {editingRvInfo ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <select value={rvType} onChange={e => setRvType(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }}>
                    <option value="RV">RV</option>
                    <option value="Park Model">Park Model</option>
                    <option value="Mobile Home">Mobile Home</option>
                    <option value="Other">Other</option>
                  </select>
                  <input placeholder="Make" value={rvMake} onChange={e => setRvMake(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Model" value={rvModel} onChange={e => setRvModel(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Year" value={rvYear} onChange={e => setRvYear(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Length (ft)" type="number" value={rvLengthFt} onChange={e => setRvLengthFt(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Width (ft) — optional" type="number" value={rvWidthFt} onChange={e => setRvWidthFt(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="VIN / Tag #" value={rvVinOrTag} onChange={e => setRvVinOrTag(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={saveRvInfo}
                    disabled={savingRvInfo}
                    style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: savingRvInfo ? "default" : "pointer", opacity: savingRvInfo ? 0.7 : 1 }}
                  >
                    {savingRvInfo ? "Saving..." : "Save"}
                  </button>
                  {/* Only offer Cancel once there's actually saved data to fall back to
                      — a resident entering this info for the first time has nothing to
                      cancel back to, so forcing them into view mode would just show blanks. */}
                  {(resident?.rv_make || resident?.rv_model || resident?.rv_vin_or_tag) && (
                    <button
                      onClick={() => {
                        setRvType(resident?.rv_type || "RV");
                        setRvMake(resident?.rv_make || "");
                        setRvModel(resident?.rv_model || "");
                        setRvYear(resident?.rv_year || "");
                        setRvLengthFt(resident?.rv_length_ft ? String(resident.rv_length_ft) : "");
                        setRvWidthFt(resident?.rv_width_ft ? String(resident.rv_width_ft) : "");
                        setRvVinOrTag(resident?.rv_vin_or_tag || "");
                        setRvMessage("");
                        setEditingRvInfo(false);
                      }}
                      disabled={savingRvInfo}
                      style={{ background: "transparent", color: "#000", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12 }}>
                <p style={{ fontWeight: 700 }}>{rvType || "RV"} — {rvYear} {rvMake} {rvModel}</p>
                <p style={{ fontSize: 13 }}>{rvLengthFt ? `${rvLengthFt} ft` : "Length not set"}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>VIN / Tag #: {rvVinOrTag || "—"}</p>
              </div>
            )}
            {rvMessage && <p style={{ fontSize: 13, marginTop: 8, color: rvMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>{rvMessage}</p>}
          </div>

        </div>
      </section>
    </>
  );
}
