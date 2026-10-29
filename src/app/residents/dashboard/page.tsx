"use client";
import InstallApp, { AppBadge } from "@/components/InstallApp";
import SmsAlertsToggle from "@/components/SmsAlertsToggle";
import { portalConfirm, portalAlert } from "@/components/portalDialog";
import GolfCartCard from "@/components/GolfCartCard";
import { Fragment, useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import AutopaySection from "@/components/AutopaySection";
import BankPayBanner from "@/components/BankPayBanner";
import { returnedFeeSentence } from "@/lib/autopayTerms";
import ResidentPushAlerts from "@/components/ResidentPushAlerts";
import { closeSeenNotifications } from "@/lib/closeNotifications";
import { isInvoicePayableNow, invoicePayableFrom, isPayAheadInvoice } from "@/lib/invoicePayable";
import LeaseAddendaCard, { fetchLeaseAddenda, type PortalAddendum } from "@/components/LeaseAddendaCard";
import { ParkInfoSection, ParkInfoHomeCard, fetchParkInfo, type ParkInfoData } from "@/components/ParkInfo";

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

// Oct 26 (per Mely): portal sections — same idea as the marina boater account.
type SectionId = "home" | "pay" | "lot" | "household" | "requests" | "messages" | "info" | "more";
const SECTIONS: { id: SectionId; label: string; short: string; icon: string }[] = [
  { id: "home", label: "Home", short: "Home", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" },
  { id: "pay", label: "Payments", short: "Pay", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { id: "lot", label: "My lot & home", short: "My lot", icon: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  { id: "household", label: "Household", short: "Household", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3" },
  { id: "requests", label: "Requests", short: "Requests", icon: "M14 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-3 3-3-3z" },
  { id: "messages", label: "Messages", short: "Messages", icon: "M4 5h16v11H8l-4 4z" },
  // Oct 28 (per Mely): office hours, emergency phone + what to do, after-hours note, park rules.
  { id: "info", label: "Park info", short: "Park info", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" },
  { id: "more", label: "Profile & more", short: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];
const MOBILE_TABS: SectionId[] = ["home", "pay", "lot", "messages", "more"];
const UNDER_MORE: SectionId[] = ["household", "requests", "info", "more"];
// Old anchors (from other pages and emails) → the section that now holds them.
const ANCHOR_SECTION: Record<string, SectionId> = {
  "household-occupants": "household", "visitors-section": "household", vehicles: "household", "golf-carts": "household",
  "move-out": "lot", "move-out-request": "lot", "rent-to-own": "lot", "parking-pets": "lot", "home-info": "lot", documents: "lot",
  autopay: "pay", invoices: "pay", charges: "pay", electric: "pay",
  maintenance: "requests", propane: "requests",
  announcements: "messages", notifications: "messages",
  profile: "more", "resident-info": "more", "emergency-contact": "more", marketplace: "more",
  "park-info": "info", emergency: "info", "emergency-line": "info", "office-hours": "info", "park-rules": "info",
  "lease-addendum": "home", // Oct 28: Lease Addenda card (link in the "please sign" email)
};
const ANCHORS = Object.keys(ANCHOR_SECTION);
// Oct 29 (per Mely — "que el menú enseñe lo que tienen adentro, como Documents"): what each section
// holds, shown under the open section in the side menu and as quick links at the top on a phone.
type SubItem = { label: string; anchor?: string; href?: string };
const SUBMENU: Partial<Record<SectionId, SubItem[]>> = {
  pay: [{ label: "Autopay", anchor: "autopay" }, { label: "Charges & invoices", anchor: "charges" }, { label: "Electric usage", anchor: "electric" }],
  lot: [{ label: "Home info", anchor: "home-info" }, { label: "Parking & pets", anchor: "parking-pets" }, { label: "Rent-to-own", anchor: "rent-to-own" }, { label: "Documents", href: "/residents/documents" }, { label: "Moving out", anchor: "move-out" }],
  household: [{ label: "Occupants", anchor: "household-occupants" }, { label: "Visitors", anchor: "visitors-section" }, { label: "Vehicles", anchor: "vehicles" }, { label: "Golf carts", anchor: "golf-carts" }],
  requests: [{ label: "Maintenance", anchor: "maintenance" }, { label: "Propane", anchor: "propane" }],
  messages: [{ label: "Notifications", anchor: "notifications" }, { label: "Announcements", anchor: "announcements" }],
  info: [{ label: "Call 9-1-1 first", anchor: "emergency" }, { label: "Park emergency line", anchor: "emergency-line" }, { label: "Office hours", anchor: "office-hours" }, { label: "Park rules", anchor: "park-rules" }],
  // Oct 29 (per Mely — "dentro de profile haz otro sub menú con lo que hay, ex. marketplace").
  more: [{ label: "My information", anchor: "resident-info" }, { label: "Emergency contact", anchor: "emergency-contact" }, { label: "Marketplace", anchor: "marketplace" }, { label: "Documents", href: "/residents/documents" }],
};
const sectionFor = (h: string): SectionId | null =>
  SECTIONS.some((x) => x.id === h) ? (h as SectionId) : ANCHOR_SECTION[h] || null;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function NavIcon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}


// "Nov 1, 2026" from "2026-11-01" (no time-zone shift).
function formatShortDate(iso: string): string {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  const [billOfSaleSignatureInput, setBillOfSaleSignatureInput] = useState("");
  const [signingBillOfSale, setSigningBillOfSale] = useState(false);
  const [billOfSaleMessage, setBillOfSaleMessage] = useState("");
  // Oct 28 (per Mely): lease addenda the park sent to sign online (e.g. Returned Payments).
  const [leaseAddenda, setLeaseAddenda] = useState<PortalAddendum[]>([]);
  const [addendaLandlord, setAddendaLandlord] = useState("");
  // Oct 28 (per Mely): Park info (office hours, emergencies, after-hours note, rules).
  const [parkInfo, setParkInfo] = useState<ParkInfoData | null>(null);
  function loadLeaseAddenda(id: string) {
    fetchLeaseAddenda(id).then((r) => { setLeaseAddenda(r.addenda); setAddendaLandlord(r.landlord); }).catch(() => setLeaseAddenda([]));
  }
  // Sep 18 (per Mely): resident-facing notification bell — every
  // automatic system event (invoice, electric reading, maintenance
  // update, announcement, household background-check result) or manual
  // admin message that concerns this resident.
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifLoadedOnce, setNotifLoadedOnce] = useState(false);

  // Oct 9: mirror unread notifications on the installed app's icon.
  // Oct 26 (per Mely): the icon number is now everything that needs attention (see <AppBadge> below).
  useEffect(() => {
    if (notifLoadedOnce) {
      closeSeenNotifications(
        new Set(notifications.filter((x: any) => !x.resident_read_at).map((x: any) => String(x.id)))
      );
    }
  }, [notifications, notifLoadedOnce]);

  async function loadNotifications(overrideResidentId?: string) {
    const id = overrideResidentId || residentId;
    if (!id) return;
    const res = await fetch(`/api/portal/notifications?residentId=${id}`);
    const result = await res.json();
    if (res.ok) {
      setNotifications(result.notifications || []);
      setNotifLoadedOnce(true);
    }
  }

  async function handleMarkAllNotificationsRead() {
    await fetch("/api/portal/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, markAllRead: true }),
    });
    loadNotifications();
  }
  const [nextPaymentDate, setNextPaymentDate] = useState<string | null>(null);
  const [propaneOrders, setPropaneOrders] = useState<any[]>([]);
  const [maintenanceRequests, setMaintenanceRequests] = useState<any[] | null>(null);
  const [acceptOnlinePayments, setAcceptOnlinePayments] = useState(true);
  // Oct 28 (per Mely): bank (ACH) payments — park setting + the fee constants from the server
  // (src/lib/platformFee.ts via /api/portal/fee-settings), so the exact fee shows for each choice.
  const [achEnabled, setAchEnabled] = useState(false);
  const [achMinAmount, setAchMinAmount] = useState(100);
  const [passProcessingFee, setPassProcessingFee] = useState(true);
  const [feeRates, setFeeRates] = useState<{ cardPercent: number; cardMinimum: number; achPercent: number; achMinimum: number; achMaximum: number; achReturnFee: number; returnFeePhrase?: string } | null>(null);
  const [showPayChoice, setShowPayChoice] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  // Invoices paid by bank that are still clearing (status "Processing") — not owed again.
  const [processingInvoices, setProcessingInvoices] = useState<any[]>([]);
  // Oct 28 (review): Pending invoices for a future month (e.g. next month's electric) — shown as
  // "Upcoming", not owed and not payable until that month starts.
  const [upcomingInvoices, setUpcomingInvoices] = useState<any[]>([]);
  // Oct 29 (review B1): next month's invoice, payable early but OPTIONAL — its own "Pay ahead" button,
  // never part of Outstanding / Pay Now.
  const [payAheadInvoices, setPayAheadInvoices] = useState<any[]>([]);
  // Which payment the "How would you like to pay?" dialog is for.
  const [payScope, setPayScope] = useState<"due" | "ahead">("due");
  const [invoiceGenDay, setInvoiceGenDay] = useState<number | undefined>(undefined); // company invoice day
  const [autopayAvailable, setAutopayAvailable] = useState(false);
  const [moveOutThresholdDays, setMoveOutThresholdDays] = useState(15);
  const [autopayEnabled, setAutopayEnabled] = useState(false);
  const [autopayCardLast4, setAutopayCardLast4] = useState<string | null>(null);
  // Oct 28: "ach" (bank autopay) | "card" | null (older card autopay / column not added yet)
  const [autopayMethod, setAutopayMethod] = useState<string | null>(null);
  // Oct 28: which choice is selected in the "How would you like to pay?" dialog (bank preselected).
  const [payMethodChoice, setPayMethodChoice] = useState<"ach" | "card">("ach");
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
  // Oct 19 (per Mely): adults (18+) need their SSN — stored privately, never shown back
  const [occSsn, setOccSsn] = useState("");
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
  // Oct 19 (per Mely — Aloha paper form): per-pet details + the park's
  // restricted-breed notice (from Lease Defaults → Breed/Pet Restrictions).
  type PortalPet = { type: string; name: string; breed: string; color: string; weight: string; shots_provided: "" | "yes" | "no" };
  const emptyPortalPet: PortalPet = { type: "", name: "", breed: "", color: "", weight: "", shots_provided: "" };
  const [petDetailsInput, setPetDetailsInput] = useState<PortalPet[]>([]);
  const [petRestrictions, setPetRestrictions] = useState("");
  // Oct 19 (per Mely): golf cart settings from Lease Defaults
  const [golfCartsMax, setGolfCartsMax] = useState(2);
  const [lateGrace, setLateGrace] = useState<{ on: boolean; days: number }>({ on: false, days: 0 });
  const [golfCartInsuranceRequired, setGolfCartInsuranceRequired] = useState(true);
  // Oct 28 (per Mely): park switch "Residents can send maintenance requests from their portal"
  // (admin Maintenance Requests module) — OFF by default. Off = no maintenance card/list/lines.
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
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

  // Coming back from Stripe with the browser's Back button restores this page as it was —
  // re-enable the pay buttons instead of leaving them stuck on "Opening secure payment…".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setStartingPayment(false); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
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
    setAutopayMethod(residentData?.autopay_method || null);
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

    loadNotifications(residentId);
    loadLeaseAddenda(residentId);

    fetch(`/api/portal/billing-info?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setNextPaymentDate(result.nextPaymentDate || null))
      .catch(() => setNextPaymentDate(null));

    fetch(`/api/portal/propane-orders?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setPropaneOrders(result.orders || []))
      .catch(() => setPropaneOrders([]));

    // Oct 26 (per Mely): open maintenance requests for Home + Requests —
    // same route the Maintenance page already uses.
    fetch(`/api/portal/maintenance-requests?residentId=${residentId}`)
      .then((res) => res.json())
      .then((result) => setMaintenanceRequests(result.requests || []))
      .catch(() => setMaintenanceRequests([]));

    // FOUND (Aug 3): company_fee_settings was read directly with the anon
    // key here, which is very likely blocked by RLS the same way
    // resident_occupants/resident_vehicles were (commit 6730b12) — that
    // would silently make autopayAvailable always false, hiding the
    // Autopay section regardless of the real setting. Moved to a
    // session-guarded server route (Service Role Key).
    fetchParkInfo(residentId).then(setParkInfo);
    const feeSettingsData = await fetch(`/api/portal/fee-settings?residentId=${residentId}`)
      .then((r) => r.json())
      .catch(() => null);
    setAcceptOnlinePayments(feeSettingsData?.acceptOnlinePayments ?? true);
    setAutopayAvailable(!!feeSettingsData?.autopayAvailable);
    setMoveOutThresholdDays(feeSettingsData?.moveOutThresholdDays ?? 15);
    setPetRestrictions(feeSettingsData?.petRestrictions || "");
    setGolfCartsMax(typeof feeSettingsData?.golfCartsMax === "number" ? feeSettingsData.golfCartsMax : 2);
    setLateGrace({ on: !!feeSettingsData?.lateFeeEnabled, days: Number(feeSettingsData?.lateFeeGraceDays || 0) });
    setGolfCartInsuranceRequired(feeSettingsData?.golfCartInsuranceRequired !== false);
    setMaintenanceEnabled(feeSettingsData?.maintenanceRequestsEnabled === true);
    setAchEnabled(!!feeSettingsData?.achEnabled);
    setAchMinAmount(typeof feeSettingsData?.achMinAmount === "number" ? feeSettingsData.achMinAmount : 100);
    setPassProcessingFee(feeSettingsData?.passProcessingFeeToResident !== false);
    setFeeRates(feeSettingsData?.fees || null);

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

    const { invoices: allInvoices, invoiceGenerateDay } = await fetch(`/api/portal/invoices?residentId=${residentId}`)
      .then((res) => res.json())
      .catch(() => ({ invoices: [] }));
    if (Number(invoiceGenerateDay) > 0) setInvoiceGenDay(Number(invoiceGenerateDay));
    const pendingAll = (allInvoices || [])
      .filter((inv: any) => inv.status === "Pending")
      .sort((a: any, b: any) => (a.due_date || "").localeCompare(b.due_date || ""));
    // Oct 28 (review): "being prepared" (preparing_until, from the server) = this month's invoice still
    // waiting for rent — shown under Upcoming too, without Pay.
    const payableNow = (inv: any) => isInvoicePayableNow(inv.invoice_month) && !inv.preparing_until;
    const payableAll = pendingAll.filter(payableNow);
    const invs = payableAll.filter((inv: any) => !isPayAheadInvoice(inv));
    const ahead = payableAll.filter((inv: any) => isPayAheadInvoice(inv));
    setPendingInvoices(invs || []);
    setPayAheadInvoices(ahead);
    setUpcomingInvoices(pendingAll.filter((inv: any) => !payableNow(inv)));
    setProcessingInvoices((allInvoices || []).filter((inv: any) => inv.status === "Processing"));

    // Fetch each pending invoice's itemized line items (Rent, Wifi,
    // Electric, Maintenance, etc.) via the same route the Invoices page
    // uses, so Outstanding Charges can show the real breakdown per charge.
    if (payableAll.length > 0) {
      const itemsEntries = await Promise.all(
        payableAll.map(async (inv: any) => {
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

    // Oct 22 (security): announcements come from the portal API (signed-in session), not the public key.
    const annRes = await fetch("/api/portal/announcements", { cache: "no-store" }).catch(() => null);
    const annJson = annRes && annRes.ok ? await annRes.json().catch(() => null) : null;
    setAnnouncements(annJson?.announcements || []);

    setMessage("");
  }

  // Oct 28 (per Mely): when the park offers bank (ACH) payments and the balance is at or above its
  // minimum, "Pay Now" first asks bank or card, showing the exact fee of each.
  const payAheadTotal = payAheadInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
  const achEligibleFor = (amount: number) => achEnabled && !!feeRates && amount > 0 && amount >= achMinAmount;
  const achEligible = achEligibleFor(outstandingBalance);
  // The dialog's amount: what is owed now, or (Pay ahead) next month's invoice.
  const payAmount = payScope === "ahead" ? payAheadTotal : outstandingBalance;
  const cardFee = !passProcessingFee || !feeRates ? 0 : Math.max(payAmount * feeRates.cardPercent, feeRates.cardMinimum);
  const achFee = !passProcessingFee || !feeRates ? 0
    : Math.round(Math.min(Math.max(payAmount * feeRates.achPercent, feeRates.achMinimum), feeRates.achMaximum) * 100) / 100;
  const processingTotal = processingInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

  // Oct 28 (per Mely): fees for the monthly rent, to show bank autopay's real saving.
  const autopayExample = Number(resident?.rent_amount || 0) > 0 ? Number(resident.rent_amount) : outstandingBalance;
  const bankAutopayOption = achEnabled && feeRates ? {
    enabled: true,
    passFee: passProcessingFee,
    exampleAmount: autopayExample,
    cardFee: !passProcessingFee ? 0 : Math.round(Math.max(autopayExample * feeRates.cardPercent, feeRates.cardMinimum) * 100) / 100,
    achFee: !passProcessingFee ? 0 : Math.round(Math.min(Math.max(autopayExample * feeRates.achPercent, feeRates.achMinimum), feeRates.achMaximum) * 100) / 100,
    achMin: achMinAmount,
    returnFee: feeRates.achReturnFee,
    returnFeePhrase: feeRates.returnFeePhrase,
  } : null;

  async function handlePayNow() {
    setPayScope("due");
    if (achEligible) {
      setPayMethodChoice("ach");
      setShowPayChoice(true);
      return;
    }
    await startPayment("card", "due");
  }

  // Oct 29 (review B1): optional early payment of next month's invoice (same fees and checks).
  async function handlePayAhead() {
    setPayScope("ahead");
    if (achEligibleFor(payAheadTotal)) {
      setPayMethodChoice("ach");
      setShowPayChoice(true);
      return;
    }
    await startPayment("card", "ahead");
  }

  async function startPayment(method: "card" | "ach", scope: "due" | "ahead" = payScope) {
    const residentId = localStorage.getItem("resident_id");

    if (!residentId) {
      router.push("/login");
      return;
    }

    setStartingPayment(true);
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ residentId, method, scope }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStartingPayment(false);
      void portalAlert(data.error || "Could not start payment.");
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
    if (!(await portalConfirm("Cancel your move-out request? You can submit a new date afterward.", { danger: true }))) return;
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
    if (petsAllowedInput && petDetailsInput.length === 0) {
      setPetsMessage("Please select how many pets you have.");
      return;
    }
    if (
      petsAllowedInput &&
      petDetailsInput.some((p) => !p.type.trim() || !p.name.trim() || !p.breed.trim() || !p.color.trim() || !p.weight.trim() || !p.shots_provided)
    ) {
      setPetsMessage("Please fill in type, name, breed, color, weight, and shots records for each pet.");
      return;
    }
    try {
      const res = await fetch("/api/portal/save-pets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          petsAllowed: petsAllowedInput,
          petsCount: petsCountInput,
          petsTypes: petsTypesInput,
          petDetails: petDetailsInput,
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
    // Oct 19 (per Mely — Aloha's paper application): adults (18+) living
    // here must give their own email and Social Security number. When
    // editing, the SSN can be left blank to keep the one already on file.
    const occAge = calculateAge(occDateOfBirth);
    const occIsAdult = occType === "household" && occAge !== null && occAge >= 18;
    const occSsnDigits = occSsn.replace(/\D/g, "");
    if (occIsAdult && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(occEmail.trim())) {
      setOccupantMessage("Please enter a valid email for this adult (18+).");
      return;
    }
    if (occIsAdult && !editingVisitorId && occSsnDigits.length !== 9) {
      setOccupantMessage("Please enter this adult's Social Security # (9 digits).");
      return;
    }
    if (occIsAdult && editingVisitorId && occSsnDigits.length > 0 && occSsnDigits.length !== 9) {
      setOccupantMessage("Social Security # must be 9 digits (or leave it blank to keep the one on file).");
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
          ssn: occIsAdult && occSsnDigits.length === 9 ? occSsnDigits : undefined,
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
      setOccSsn("");
      setOccType("household");
      setEditingVisitorId(null);
      setAddingOccupant(false);
      // Oct 19 (per Mely): after saving, keep the resident on the Household
      // Occupants section (instead of jumping elsewhere) so they see right
      // away if an adult still needs a photo ID uploaded.
      const savedType = occType;
      await loadResidentDashboard();
      setTimeout(() => {
        const el = document.getElementById(savedType === "visitor" ? "visitors-section" : "household-occupants");
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 90;
          window.scrollTo({ top, behavior: "smooth" });
        }
      }, 150);
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
    setOccSsn("");
    setOccType(person.occupant_type === "visitor" ? "visitor" : "household");
    setAddingOccupant(true);
  }

  async function deleteVisitor(id: string) {
    if (!(await portalConfirm("Remove this person?", { danger: true }))) return;
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
    const confirmed = await portalConfirm("Remove this vehicle?");
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
        loadResidentDashboard(); // Oct 26: refresh so the "add your home info" reminder clears right away
      }
    } catch (err: any) {
      setRvMessage("Could not save RV info (unexpected error): " + (err?.message || err));
    }
    setSavingRvInfo(false);
  }


  // Oct 26 (per Mely): the portal is split into sections with a menu (side
  // menu on a computer, tab bar on a phone) — same layout as the marina
  // boater account. The section lives in the address (#pay, #lot…) so the
  // back button and links from emails work. Old anchors keep working:
  // #household-occupants / #visitors-section → Household, #move-out-request
  // → My lot (and opens the Moving Out form), etc.
  const [section, setSection] = useState<SectionId>("home");
  // Snapshot of the notifications that were still unread when the resident
  // opened Messages, so they stay highlighted as "new" after being marked read.
  const [freshNotifIds, setFreshNotifIds] = useState<Set<string>>(new Set());
  const residentLoaded = !!resident;
  useEffect(() => {
    if (!residentLoaded) return;
    const go = () => {
      const h = window.location.hash.replace("#", "");
      setSection(sectionFor(h) || "home");
      if (h === "move-out" || h === "move-out-request") setShowMoveOutModal(true);
      if (h && ANCHORS.includes(h)) {
        setTimeout(() => {
          const el = document.getElementById(h);
          if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
        }, 250);
      } else {
        window.scrollTo({ top: 0 });
      }
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [residentLoaded]);
  function subItems(id: SectionId): SubItem[] {
    return (SUBMENU[id] || []).filter((it) => it.anchor !== "maintenance" || maintenanceEnabled).filter((it) => it.anchor !== "propane" || propaneOrders.length > 0);
  }
  function openSub(it: SubItem) {
    if (it.href) { router.push(it.href); return; }
    if (!it.anchor) return;
    if (window.location.hash.replace("#", "") === it.anchor) {
      if (it.anchor === "move-out") setShowMoveOutModal(true);
      const el = document.getElementById(it.anchor);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
      return;
    }
    window.location.hash = it.anchor;
  }
  function openSection(id: SectionId) {
    if (window.location.hash.replace("#", "") === id) { setSection(id); window.scrollTo({ top: 0 }); return; }
    window.location.hash = id;
  }
  // Opening Messages counts as seeing them — same rule as opening the bell (Sep 19).
  useEffect(() => {
    if (section !== "messages" || !notifLoadedOnce) return;
    const unread = notifications.filter((n: any) => !n.resident_read_at);
    if (unread.length === 0) return;
    setFreshNotifIds(new Set(unread.map((n: any) => String(n.id))));
    handleMarkAllNotificationsRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, notifLoadedOnce]);


  if (!resident) {
    return (
      <div style={{ padding: 60, textAlign: "center", background: "#f6f5f5", minHeight: "100vh" }}>
        <p>{message}</p>
      </div>
    );
  }

  // ---- Oct 26 (per Mely): sections + "Needs your attention" ----
  // Everything below is computed from data this page already loads (plus
  // the resident's own maintenance requests, from the same route the
  // Maintenance page uses).
  const todayKey = new Date().toLocaleDateString("en-CA");
  const overdueInvoices = pendingInvoices.filter((inv: any) => inv.due_date && String(inv.due_date).slice(0, 10) < todayKey);
  const overdueTotal = overdueInvoices.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
  const unreadNotifs = notifications.filter((n: any) => !n.resident_read_at);
  // Autopay failed = the latest autopay charge notice is a failure and there's still a balance.
  const lastAutopayNotice = notifications.find((n: any) => n.update_type === "autopay_failed" || n.update_type === "autopay_charged");
  const autopayFailed = autopayEnabled && outstandingBalance > 0 && lastAutopayNotice?.update_type === "autopay_failed";
  const householdPeople = occupants.filter((p: any) => p.occupant_type !== "visitor");
  const visitorPeople = occupants.filter((p: any) => p.occupant_type === "visitor");
  const bgTodo = householdPeople.filter((p: any) => {
    const age = calculateAge(p.date_of_birth);
    const st = p.background_check_status;
    return age !== null && age >= 18 && !(st === "Passed" || st === "in_progress" || st === "invitation_sent" || st === "Needs Review");
  });
  const billOfSaleToSign = rentToOwnPlan?.status === "pending_signatures" && !rentToOwnPlan?.resident_signed_at;
  const rvInfoMissing = !resident?.rv_make && !resident?.rv_model && !resident?.rv_vin_or_tag;
  const emergencyMissing = !resident?.emergency_contact_name;
  const petsNoShots: any[] = resident?.pets_allowed && Array.isArray(resident?.pet_details)
    ? resident.pet_details.filter((p: any) => p?.shots_provided === "no")
    : [];
  const propaneReady = propaneOrders.filter((o: any) => !o.redeemed);
  const openMaintenance = !maintenanceEnabled ? [] : (maintenanceRequests || []).filter((r: any) => !/complete|closed|resolved|done|cancel/i.test(String(r.status || "")));

  type AttnItem = { key: string; text: string; sub?: string; tone: "bad" | "warn" | "info"; go: SectionId; href?: string; anchor?: string };
  const attention: AttnItem[] = [];
  if (overdueInvoices.length) {
    attention.push({ key: "od", text: `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"}`, sub: `${money(overdueTotal)} past due`, tone: "bad", go: "pay", anchor: "charges" });
  } else if (pendingInvoices.length) {
    attention.push({ key: "due", text: `Balance due: ${money(outstandingBalance)}`, sub: nextPaymentDate ? `Next payment due ${nextPaymentDate}` : `${pendingInvoices.length} invoice${pendingInvoices.length === 1 ? "" : "s"} to pay`, tone: "warn", go: "pay", anchor: "charges" });
  }
  if (autopayFailed) attention.push({ key: "ap", text: autopayMethod === "ach" ? "Autopay could not take the bank payment" : "Autopay could not charge your card", sub: autopayMethod === "ach" ? "Pay by hand or set up autopay again" : "Update your card or pay by hand", tone: "bad", go: "pay", anchor: "autopay" });
  for (const p of bgTodo) {
    attention.push(p.has_id_uploaded
      ? { key: "bg" + p.id, text: "Background check needed", sub: `${p.full_name} — ID received, start the check`, tone: "bad", go: "household", href: "/residents/background-checks" }
      : { key: "id" + p.id, text: "Photo ID needed", sub: `${p.full_name} is 18+ — upload an ID, then the background check`, tone: "bad", go: "household", href: `/residents/documents?forOccupant=${p.id}` });
  }
  if (!bgTodo.length && pendingBgChecks.length) attention.push({ key: "bgp", text: "Background check needed", sub: `${pendingBgChecks.length} household occupant${pendingBgChecks.length === 1 ? "" : "s"}`, tone: "bad", go: "household", href: "/residents/background-checks" });
  const addendaToSign = leaseAddenda.filter((a) => a.status === "pending");
  for (const a of addendaToSign) attention.push({ key: "la" + a.id, text: `Please sign: ${a.title}`, sub: "Review and sign it online — it takes a minute", tone: "warn", go: "home", anchor: "lease-addendum" });
  if (billOfSaleToSign) attention.push({ key: "bos", text: "Sign your Bill of Sale", sub: "Your Rent-to-Own home is paid off", tone: "warn", go: "lot", anchor: "rent-to-own" });
  if (rvInfoMissing) attention.push({ key: "rv", text: "Add your home/unit info", sub: "Make, model and VIN / Tag #", tone: "warn", go: "lot", anchor: "home-info" });
  if (emergencyMissing) attention.push({ key: "ec", text: "Add an emergency contact", tone: "warn", go: "more", anchor: "profile" });
  if (petsNoShots.length) attention.push({ key: "pets", text: "Pet shots records not provided", sub: petsNoShots.map((p: any) => p.name || "Pet").join(", "), tone: "warn", go: "lot", anchor: "parking-pets" });
  if (propaneReady.length) attention.push({ key: "pr", text: `${propaneReady.length} propane order${propaneReady.length === 1 ? "" : "s"} ready for pickup`, sub: "Show the QR code to staff", tone: "info", go: "requests", anchor: "propane" });
  if (unreadNotifs.length) attention.push({ key: "nt", text: `${unreadNotifs.length} new notification${unreadNotifs.length === 1 ? "" : "s"}`, sub: unreadNotifs[0]?.message, tone: "info", go: "messages" });

  const badge: Partial<Record<SectionId, number>> = {
    pay: pendingInvoices.length + (autopayFailed ? 1 : 0),
    lot: (billOfSaleToSign ? 1 : 0) + (rvInfoMissing ? 1 : 0) + (petsNoShots.length ? 1 : 0),
    household: bgTodo.length || pendingBgChecks.length,
    requests: propaneReady.length,
    messages: unreadNotifs.length,
    more: emergencyMissing ? 1 : 0,
  };
  const moreTabBadge = (badge.household || 0) + (badge.requests || 0) + (badge.more || 0);
  const Badge = ({ n }: { n?: number }) => (n ? <span className="rp-nav-badge">{n}</span> : null);
  const sectionTitle = SECTIONS.find((x) => x.id === section)?.label || "";
  // Oct 28 (per Mely): Requests holds maintenance (if the park turned it on) and propane orders.
  // Nothing to show there → hide the Requests nav item too.
  const requestsVisible = maintenanceEnabled || propaneOrders.length > 0;
  const navSections = SECTIONS.filter((x) => x.id !== "requests" || requestsVisible);
  function goTo(item: { go: SectionId; anchor?: string }) {
    if (item.anchor) { window.location.hash = item.anchor; return; }
    openSection(item.go);
  }

  const Tile = ({ go, h, lines, cta = "View all", anchor }: { go: SectionId; h: string; lines: (string | null | false | undefined)[]; cta?: string; anchor?: string }) => (
    <button type="button" className="rp-tile" onClick={() => goTo({ go, anchor })}>
      <span className="rp-tile-h">{h}<Badge n={anchor ? undefined : badge[go]} /></span>
      {lines.filter(Boolean).map((l, n) => <span key={n} className={n === 0 ? "rp-tile-main" : "rp-tile-line"}>{l}</span>)}
      <span className="rp-tile-cta">{cta} →</span>
    </button>
  );

  const rtoLine = rentToOwnPlan
    ? rentToOwnPlan.status === "pending_signatures"
      ? "Rent-to-Own paid off — Bill of Sale"
      : `Rent-to-Own: ${money(Number(rentToOwnPlan.paid_so_far || 0))} of ${money(Number(rentToOwnPlan.total_price || 0))}`
    : null;

  const notifRow = (n: any, isNew: boolean) => (
                    <div
                      key={n.id}
                      style={{
                        padding: "10px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13,
                        background: isNew ? "#eff6ff" : "#fff",
                        display: "flex", alignItems: "flex-start", gap: 8,
                      }}
                    >
                      <div
                        onClick={async () => {
                          if (!n.resident_read_at) {
                            await fetch("/api/portal/notifications", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ residentId, id: n.id }),
                            });
                            loadNotifications();
                          }
                        }}
                        style={{ flex: 1, cursor: "pointer" }}
                      >
                        <div>{n.message}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                          {new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}
                        </div>
                      </div>
                      {/* Sep 18 (per Mely): lets the resident dismiss a
                          single notification. */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await fetch(`/api/portal/notifications?residentId=${residentId}&id=${n.id}`, { method: "DELETE" });
                          loadNotifications();
                        }}
                        style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: 14, padding: "0 4px", lineHeight: 1 }}
                        title="Dismiss"
                      >
                        ✕
                      </button>
                    </div>
  );

  return (
    <>
      <section className="rp-hero">
        <div style={{ maxWidth: 1140, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#d3f8e2", fontWeight: 600, marginBottom: 8 }}>Resident Portal</div>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, marginBottom: 4 }}>{section === "home" ? `Welcome, ${resident.full_name}` : sectionTitle}</h1>
            <p style={{ color: "#000000", fontSize: 14 }}>{resident.rv_lots?.lot_name ? `Lot ${resident.rv_lots.lot_name}` : (resident.companies?.company_name || "")}</p>
            <ResidentPushAlerts residentId={residentId} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <button
              onClick={() => {
                // Sep 19 (per Mely): opening the bell itself marks
                // everything read automatically — no manual confirm
                // step, so the admin can tell it was actually seen just
                // from the read timestamp, without the resident having
                // to do anything extra.
                const opening = !showNotifications;
                setShowNotifications((v) => !v);
                if (opening) handleMarkAllNotificationsRead();
              }}
              style={{ background: "transparent", border: "1.5px solid #000000", color: "#000000", borderRadius: 6, padding: "10px 14px", fontWeight: 600, cursor: "pointer", position: "relative" }}
            >
              🔔
              {notifications.filter((n) => !n.resident_read_at).length > 0 && (
                <span
                  style={{
                    position: "absolute", top: -6, right: -6, background: "#dc2626", color: "#fff",
                    borderRadius: "50%", width: 20, height: 20, fontSize: 11, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {notifications.filter((n) => !n.resident_read_at).length}
                </span>
              )}
            </button>
            {showNotifications && (
              <div
                className="rp-notif-pop"
                style={{
                  position: "absolute", top: "110%", right: 0, background: "#fff", color: "#000",
                  borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.15)", width: 340, maxHeight: 420,
                  overflowY: "auto", zIndex: 50, border: "1px solid #e5e7eb",
                }}
              >
                <div style={{ padding: "10px 14px", borderBottom: "1px solid #e5e7eb" }}>
                  <strong style={{ fontSize: 13 }}>Notifications</strong>
                </div>
                {notifications.length === 0 ? (
                  <p style={{ padding: 16, fontSize: 13, color: "#6b7280" }}>Nothing yet.</p>
                ) : (
                  notifications.map((n) => notifRow(n, !n.resident_read_at))
                )}
              </div>
            )}
            <button onClick={logout} style={{ background: "transparent", border: "1.5px solid #000000", color: "#000000", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
              Sign Out
            </button>
          </div>
        </div>
      </section>

      <section className="rp-wrap">
        <div className="rp-portal">
          <nav className="rp-nav" aria-label="Resident portal">
            {navSections.map((x) => (
              <Fragment key={x.id}>
              <button type="button" className={section === x.id ? "on" : ""} onClick={() => openSection(x.id)} aria-current={section === x.id ? "page" : undefined}>
                <NavIcon d={x.id === "more" ? "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" : x.icon} /><span>{x.label}</span><Badge n={badge[x.id]} />
              </button>
              {section === x.id && subItems(x.id).length > 0 && (
                <div className="rp-subnav">
                  {subItems(x.id).map((it) => (
                    <button key={it.label} type="button" onClick={() => openSub(it)}>{it.label}</button>
                  ))}
                </div>
              )}
              </Fragment>
            ))}
          </nav>

          <AppBadge n={attention.length} />
          <div className="rp-main">
            {section !== "home" && subItems(section).length > 0 && (
              <div className="rp-subchips" role="navigation" aria-label="In this section">
                {subItems(section).map((it) => <button key={it.label} type="button" onClick={() => openSub(it)}>{it.label}</button>)}
              </div>
            )}
            {/* Oct 26 (per Mely): inside a section, show what the red number means — tap one to go
                straight to it. The number goes away by itself once it's done. */}
            {section !== "home" && message === "" && attention.some((a) => a.go === section) && (
              <div className="rp-attn">
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>To do here</h2>
                {attention.filter((a) => a.go === section).map((a) => {
                  const body = (<><span className={`rp-attn-dot ${a.tone}`} /><span className="rp-attn-text"><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span><span className="rp-attn-go">→</span></>);
                  return a.href
                    ? <button key={a.key} type="button" className="rp-attn-row" onClick={() => router.push(a.href!)}>{body}</button>
                    : <button key={a.key} type="button" className="rp-attn-row" onClick={() => goTo(a)}>{body}</button>;
                })}
                <p style={{ fontSize: 13, color: "#64748b", margin: "8px 0 0" }}>The red number goes away as soon as each item is done.</p>
              </div>
            )}
            {section === "home" && (<>
              {/* Oct 28 (per Mely): an addendum waiting for this resident's signature (Lease Addenda) */}
              {residentId && (
                <LeaseAddendaCard
                  residentId={residentId}
                  fullName={resident?.full_name || ""}
                  parkName={resident?.companies?.company_name || "The park"}
                  landlord={addendaLandlord}
                  addenda={leaseAddenda}
                  onChanged={() => residentId && loadLeaseAddenda(residentId)}
                />
              )}
              <div className="rp-balance">
                <div>
                  <div style={label}>Outstanding Balance</div>
                  <div className="rp-balance-big" style={{ color: outstandingBalance > 0 ? "#b91c1c" : "var(--green)" }}>${outstandingBalance.toFixed(2)}</div>
                  {overdueInvoices.length > 0 ? (
                    <div style={{ color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{money(overdueTotal)} overdue</div>
                  ) : nextPaymentDate ? (
                    <div style={{ color: "var(--gray)", fontSize: 13 }}>Next Payment (Due Date): <strong>{nextPaymentDate}</strong>{(() => { if (!lateGrace.on || !nextPaymentDate) return null; const d = new Date(nextPaymentDate); if (isNaN(d.getTime())) return null; d.setDate(d.getDate() + lateGrace.days); return <span style={{ display: "block", fontSize: 12, color: "var(--gray)", fontWeight: 400 }}>{lateGrace.days > 0 ? `Grace period: ${lateGrace.days} day${lateGrace.days === 1 ? "" : "s"}, until the end of ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. A late fee applies after that date.` : "No grace period: a late fee applies after the due date."}</span>; })()}</div>
                  ) : null}
                  {processingTotal > 0 && (
                    <div style={{ color: "#1e40af", fontWeight: 700, fontSize: 13 }}>{money(processingTotal)} bank payment processing · clears in 3–5 business days</div>
                  )}
                  {payAheadTotal > 0 && (
                    <div style={{ color: "#166534", fontSize: 13 }}>Next month&apos;s invoice is ready ({money(payAheadTotal)}) — <button type="button" className="rp-link-btn" onClick={() => openSection("pay")}>pay ahead (optional)</button></div>
                  )}
                </div>
                <div className="rp-balance-btns">
                  {acceptOnlinePayments && outstandingBalance > 0 && (
                    <button onClick={handlePayNow} style={{ background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                      Pay Now
                    </button>
                  )}
                  <button type="button" className="rp-link-btn" onClick={() => openSection("pay")}>{pendingInvoices.length ? "See charges" : "Payments"} →</button>
                </div>
              </div>

              {/* Oct 28 (per Mely): "pay by bank" announcement — only when the park has bank payments ON. */}
              {message === "" && achEnabled && feeRates && (
                <BankPayBanner
                  companyId={resident?.company_id || ""}
                  exampleAmount={outstandingBalance > 0 ? outstandingBalance : autopayExample}
                  passFee={passProcessingFee}
                  fees={feeRates}
                  canPayNow={achEligible && acceptOnlinePayments}
                  canSetUpAutopay={autopayAvailable && !(autopayEnabled && autopayMethod === "ach")}
                  hide={autopayEnabled && autopayMethod === "ach"}
                  onPay={() => { setPayMethodChoice("ach"); setShowPayChoice(true); }}
                  onAutopay={() => { window.location.hash = "autopay"; }}
                />
              )}

              {message === "" && (attention.length > 0 ? (
                <div className="rp-attn">
                  <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Needs your attention</h2>
                  {attention.map((a) => {
                    const body = (<><span className={`rp-attn-dot ${a.tone}`} /><span className="rp-attn-text"><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span><span className="rp-attn-go">→</span></>);
                    return a.href
                      ? <button key={a.key} type="button" className="rp-attn-row" onClick={() => router.push(a.href!)}>{body}</button>
                      : <button key={a.key} type="button" className="rp-attn-row" onClick={() => goTo(a)}>{body}</button>;
                  })}
                </div>
              ) : (
                <div className="rp-allset" role="status">✓ You&apos;re all set. Nothing needs your attention right now.</div>
              ))}

              <InstallApp appName={resident?.companies?.company_name || "resident"} accent="#0f5132" compact />
              <div className="rp-tiles">
                <Tile go="pay" h="Payments" lines={[
                  pendingInvoices.length ? `${money(outstandingBalance)} due · ${pendingInvoices.length} invoice${pendingInvoices.length === 1 ? "" : "s"}` : "All paid up",
                  nextPaymentDate && `Next payment ${nextPaymentDate}`,
                  autopayAvailable && (autopayEnabled ? `Autopay on${autopayCardLast4 ? ` · ${autopayMethod === "ach" ? "bank" : "card"} •••• ${autopayCardLast4}` : ""}` : "Autopay off"),
                ]} />
                <Tile go="lot" h="My lot & home" lines={[
                  resident.rv_lots?.lot_name ? `Lot ${resident.rv_lots.lot_name}` : (resident.companies?.company_name || "My lot"),
                  rvInfoMissing ? "Home/unit info not added yet" : `${rvType || "RV"} — ${[rvYear, rvMake, rvModel].filter(Boolean).join(" ")}`,
                  rtoLine || (activeLease?.requested_move_out_date ? `Move-out requested: ${activeLease.requested_move_out_date}` : null),
                ]} />
                {electricUsage.length > 0 && (
                  <Tile go="pay" anchor="electric" h="Electric usage" cta="Details" lines={[
                    `${electricUsage[0]?.billing_month || ""} · ${electricUsage[0]?.current_reading || 0} kWh`,
                    `Electric Charge ${money(Number(electricUsage[0]?.charge_amount || 0))}`,
                  ]} />
                )}
                {(householdPeople.length + visitorPeople.length + vehicles.length) > 0 && (
                  <Tile go="household" h="Household" lines={[
                    [householdPeople.length && `${householdPeople.length} occupant${householdPeople.length === 1 ? "" : "s"}`, visitorPeople.length && `${visitorPeople.length} visitor${visitorPeople.length === 1 ? "" : "s"}`, vehicles.length && `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
                    bgTodo.length ? `${bgTodo.length} background check${bgTodo.length === 1 ? "" : "s"} needed` : householdPeople.slice(0, 3).map((p: any) => p.full_name).join(", "),
                  ]} />
                )}
                {(openMaintenance.length > 0 || propaneOrders.length > 0) && (
                  <Tile go="requests" h="Requests" lines={[
                    openMaintenance.length ? `${openMaintenance.length} open maintenance request${openMaintenance.length === 1 ? "" : "s"}` : `${propaneReady.length} propane order${propaneReady.length === 1 ? "" : "s"} ready`,
                    openMaintenance[0] && `${openMaintenance[0].subject || "Request"} — ${openMaintenance[0].status}`,
                    openMaintenance.length > 0 && propaneReady.length > 0 && `${propaneReady.length} propane order${propaneReady.length === 1 ? "" : "s"} ready for pickup`,
                  ]} />
                )}
                <Tile go="messages" h="Messages" cta={notifications.length || announcements.length ? "Open" : "View"} lines={[
                  unreadNotifs.length ? `${unreadNotifs.length} new notification${unreadNotifs.length === 1 ? "" : "s"}` : announcements[0] ? announcements[0].title : notifications[0] ? "Notifications" : "No messages yet",
                  unreadNotifs.length ? unreadNotifs[0].message : announcements[0] ? announcements[0].message : notifications[0]?.message,
                ]} />
              </div>
              {/* Oct 28 (per Mely): emergency phone, 911, today's office hours — full details in Park info */}
              <ParkInfoHomeCard data={parkInfo} onOpen={() => openSection("info")} />
            </>)}

            {section === "pay" && (<>
              <div id="autopay" className="rp-anchor">
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
          {/* Oct 28 (per Mely — "quedó muy grande, reorganízalo"): the balance is a compact bar on top
              (nothing owed shows neutral — no "paid up" message before any payment exists), and Autopay sits below at full width. */}
          <div className="rent-balance-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, alignItems: "start" }}>
            {autopayAvailable && residentId ? (
              <div className="autopay-card" style={card}>
                {/* Oct 28 (per Mely): cleaner header, no emoji */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span aria-hidden style={{ width: 36, height: 36, borderRadius: 10, background: "#dcfce7", color: "#15803d", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>
                  </span>
                  <div>
                    <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>Autopay</h2>
                    <div style={{ fontSize: 12.5, color: "var(--gray)" }}>Pay your monthly balance automatically</div>
                  </div>
                </div>
                <AutopaySection
                  residentId={residentId}
                  autopayEnabled={autopayEnabled}
                  cardLast4={autopayCardLast4}
                  onChange={loadResidentDashboard}
                  parkName={resident?.companies?.company_name || ""}
                  authorizedAt={resident?.autopay_authorized_at || null}
                  autopayMethod={autopayMethod}
                  bank={bankAutopayOption}
                />
              </div>
            ) : (
              <div className="autopay-card" style={card}>
                <p style={label}>Rent Amount</p>
                <p style={bigNumber}>${resident.rent_amount}</p>
              </div>
            )}
            <div className="balance-card" style={{ ...cardAccent, order: -1, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "16px 20px" }}>
              <div>
                <p style={{ ...label, marginBottom: 2 }}>Outstanding Balance</p>
                <p style={{ fontSize: 28, fontWeight: 900, margin: 0, lineHeight: 1.1, color: outstandingBalance > 0 ? "#b91c1c" : "#111827" }}>${outstandingBalance.toFixed(2)}</p>
                <p style={{ fontSize: 12.5, color: "var(--gray)", margin: "4px 0 0" }}>{outstandingBalance > 0 ? "Due on your account now" : "Nothing due right now"}</p>
              </div>
              {acceptOnlinePayments && outstandingBalance > 0 && (
              <button
                onClick={handlePayNow}
                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "12px 26px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}
              >
                Pay Now
              </button>
              )}
            </div>
          </div>
              </div>
              <div id="charges" className="rp-anchor">
          {processingInvoices.length > 0 && (
            <div style={{ ...card, background: "#eff6ff", border: "1.5px solid #93c5fd" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>🏦 Bank payment processing</h2>
              <p style={{ color: "#1e3a8a", fontSize: 13, marginBottom: 10 }}>
                Your bank payment was received and takes 3–5 business days to clear. There is nothing to pay on these invoices meanwhile.
              </p>
              {processingInvoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, padding: "6px 0", borderTop: "1px solid #bfdbfe" }}>
                  <span>Invoice — {inv.invoice_month} <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 700, marginLeft: 4 }}>Processing (bank)</span></span>
                  <span style={{ fontWeight: 700 }}>{money(Number(inv.total_amount || 0))}</span>
                </div>
              ))}
            </div>
          )}
          {upcomingInvoices.length > 0 && (
            <div style={{ ...card, background: "#f9fafb" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Upcoming</h2>
              {upcomingInvoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span>Invoice — {inv.invoice_month} <span style={{ color: "var(--gray)", fontSize: 13 }}>· {inv.preparing_reason === "electric" ? inv.preparing_message : inv.preparing_until ? `Being prepared — available ${inv.preparing_until}` : `available to pay on ${invoicePayableFrom(inv.invoice_month, undefined, invoiceGenDay)}`}</span></span>
                  <span style={{ fontWeight: 700 }}>{money(Number(inv.total_amount || 0))}</span>
                </div>
              ))}
            </div>
          )}
          {payAheadInvoices.length > 0 && (
            <div style={{ ...card, background: "#f0fdf4", border: "1.5px solid #bbf7d0" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Pay ahead (optional)</h2>
              <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 10 }}>
                Next month&apos;s invoice is ready. You can pay it now if you like, or any time until its due date{autopayEnabled ? " — autopay pays it on the due date" : ""}.
              </p>
              {payAheadInvoices.map((inv) => {
                const items = invoiceItemsByInvoice[inv.id] || [];
                return (
                  <div key={inv.id} style={{ borderTop: "1px solid #bbf7d0", padding: "8px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, fontWeight: 700 }}>
                      <span>Invoice — {inv.invoice_month}{inv.due_date ? ` · due ${formatShortDate(inv.due_date)}` : ""}</span>
                      <span>{money(Number(inv.total_amount || 0))}</span>
                    </div>
                    {items.map((item: any) => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--gray)" }}>
                        <span>{item.description || item.charge_type || "Charge"}</span>
                        <span>${Number(item.amount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {acceptOnlinePayments && (
                <button
                  onClick={handlePayAhead}
                  style={{ marginTop: 12, width: "100%", background: "#fff", border: "2px solid #16a34a", borderRadius: 6, padding: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Pay ahead {money(payAheadTotal)}
                </button>
              )}
            </div>
          )}
          {pendingInvoices.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>Outstanding Charges</h2>
              {nextPaymentDate && (
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                  Next Payment (Due Date): <strong>{nextPaymentDate}</strong>
                  {(() => { if (!lateGrace.on || !nextPaymentDate) return null; const d = new Date(nextPaymentDate); if (isNaN(d.getTime())) return null; d.setDate(d.getDate() + lateGrace.days); return <span style={{ display: "block", fontSize: 12, color: "var(--gray)", fontWeight: 400 }}>{lateGrace.days > 0 ? `Grace period: ${lateGrace.days} day${lateGrace.days === 1 ? "" : "s"}, until the end of ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}. A late fee applies after that date.` : "No grace period: a late fee applies after the due date."}</span>; })()}
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
              </div>
              <div className="rp-links">
            <button onClick={() => router.push("/residents/invoices")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🧾 Invoices</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View your monthly invoices and charges.</p>
            </button>
            <button onClick={() => router.push("/residents/payment-history")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📜 Payment History</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View completed payments.</p>
            </button>
              </div>
              <div id="electric" className="rp-anchor">
          <div style={card}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>⚡ Electric Usage</h2>
            {electricUsage.length === 0 ? (
              <p style={{ color: "var(--gray)" }}>No electric usage available yet.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><p style={label}>Billing Month</p><p style={bigNumber}>{electricUsage[0]?.billing_month || "N/A"}</p></div>
                {/* Oct 20: parks that don't use meter numbers (the lot identifies the meter) don't show this */}
                {electricUsage[0]?.meter_number && (
                  <div><p style={label}>Meter Number</p><p style={bigNumber}>{electricUsage[0].meter_number}</p></div>
                )}
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
              </div>
          {electricUsage.length > 0 && (
            <button onClick={() => router.push("/electric-history")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📊 Electric Usage History</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View monthly electric readings, charges, and usage history.</p>
            </button>
          )}
            </>)}

            {section === "lot" && (<>
              <div id="rent-to-own" className="rp-anchor">
          {rentToOwnPlan && rentToOwnPlan.status === "pending_signatures" && (
            <div style={{ ...card, marginTop: 16, background: "#fffbeb", border: "2px solid #f59e0b" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
                🎉 Your Rent-to-Own home is fully paid off!
              </h2>
              <p style={{ ...label, marginBottom: 12 }}>
                To finalize your Bill of Sale, both you and the park need to digitally sign. Type your full
                legal name below to sign your side.
              </p>
              {rentToOwnPlan.resident_signed_at ? (
                <p style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                  ✓ You signed on {new Date(rentToOwnPlan.resident_signed_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}.{" "}
                  {rentToOwnPlan.admin_signed_at
                    ? "Waiting on the final document to generate — refresh in a moment."
                    : "Waiting on the park's signature to finalize your Bill of Sale."}
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={billOfSaleSignatureInput}
                    onChange={(e) => setBillOfSaleSignatureInput(e.target.value)}
                    placeholder="Type your full legal name to sign"
                    style={{ width: "100%", maxWidth: 360, padding: "10px 12px", borderRadius: 6, border: "1px solid #d1d5db", marginBottom: 10 }}
                  />
                  <br />
                  <button
                    disabled={signingBillOfSale || !billOfSaleSignatureInput.trim()}
                    onClick={async () => {
                      setSigningBillOfSale(true);
                      setBillOfSaleMessage("");
                      const res = await fetch("/api/portal/sign-bill-of-sale", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          residentId,
                          companyId: resident.company_id,
                          signatureName: billOfSaleSignatureInput,
                        }),
                      });
                      const result = await res.json();
                      setSigningBillOfSale(false);
                      if (!res.ok) {
                        setBillOfSaleMessage(result.error || "Something went wrong. Please try again.");
                        return;
                      }
                      setBillOfSaleMessage(
                        result.completed
                          ? "Signed! Your Bill of Sale is finalized — find it under Documents."
                          : "Signed! Waiting on the park's signature to finalize your Bill of Sale."
                      );
                      fetch(`/api/portal/rent-to-own-plan?residentId=${residentId}`)
                        .then((r) => r.json())
                        .then((d) => d.plan && setRentToOwnPlan(d.plan))
                        .catch(() => {});
                    }}
                    style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
                  >
                    {signingBillOfSale ? "Signing..." : "Sign Bill of Sale"}
                  </button>
                </>
              )}
              {billOfSaleMessage && <p style={{ ...label, marginTop: 10 }}>{billOfSaleMessage}</p>}
            </div>
          )}
          {rentToOwnPlan && rentToOwnPlan.status !== "pending_signatures" && (
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
              </div>
              <div id="home-info" className="rp-anchor">
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
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, marginBottom: 12 }}>
                  <select value={rvType} onChange={e => setRvType(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }}>
                    <option value="RV">RV</option>
                    <option value="Park Model">Park Model</option>
                    <option value="Mobile Home">Mobile Home</option>
                    <option value="Other">Other</option>
                  </select>
                  <input placeholder="Make" value={rvMake} onChange={e => setRvMake(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Model" value={rvModel} onChange={e => setRvModel(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Year" value={rvYear} onChange={e => setRvYear(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Length (ft)" type="number" value={rvLengthFt} onChange={e => setRvLengthFt(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="Width (ft) — optional" type="number" value={rvWidthFt} onChange={e => setRvWidthFt(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder="VIN / Tag #" value={rvVinOrTag} onChange={e => setRvVinOrTag(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }} />
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
              <div id="parking-pets" className="rp-anchor">
          {!editingPets ? (
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ fontWeight: 900, fontSize: 18 }}>🅿️ Parking &amp; Pets</h2>
                <button
                  onClick={() => {
                    setPetsAllowedInput(!!resident?.pets_allowed);
                    setPetsCountInput(resident?.pets_count != null ? String(resident.pets_count) : "");
                    setPetsTypesInput(resident?.pets_types || "");
                    {
                      const saved: PortalPet[] = Array.isArray(resident?.pet_details) ? resident.pet_details : [];
                      const n = saved.length || Number(resident?.pets_count) || 0;
                      setPetDetailsInput(Array.from({ length: Math.min(n, 5) }, (_, i) => ({ ...emptyPortalPet, ...(saved[i] || {}) })));
                    }
                    setPetsMessage("");
                    setEditingPets(true);
                  }}
                  style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Edit Pets
                </button>
              </div>

              <p><strong>Parking:</strong>{" "}
                {resident?.parking_provided
                  ? `${resident?.parking_spaces || "Designated"} space(s)${
                      resident?.parking_free ? "" : `, $${Number(resident?.parking_cost || 0).toFixed(2)}`
                    }`
                  : "Not provided"}
              </p>
              <p style={{ marginTop: 8 }}><strong>Pets:</strong>{" "}
                {resident?.pets_allowed
                  ? `${resident?.pets_count || 0} pet(s)${resident?.pets_types ? ` (${resident.pets_types})` : ""}`
                  : "Not permitted"}
              </p>
              {resident?.pets_allowed && Array.isArray(resident?.pet_details) && resident.pet_details.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {resident.pet_details.map((p: PortalPet, i: number) => (
                    <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
                      <strong>{p.name || `Pet ${i + 1}`}</strong>
                      {` — ${[p.type, p.breed, p.color, p.weight ? `${p.weight} lbs` : ""].filter(Boolean).join(", ")}`}
                      <span style={{ color: p.shots_provided === "yes" ? "#16a34a" : "#b45309", marginLeft: 6 }}>
                        {p.shots_provided === "yes" ? "Shots records provided" : "Shots records not provided"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ marginTop: 8 }}><strong>Parking Sticker ID#(s):</strong>{" "}
                {vehicles.length === 0
                  ? "No vehicles on file"
                  : vehicles.map((v) => v.parking_sticker_id || "Not yet assigned").join(", ")}
              </p>
              <p style={{ marginTop: 8 }}><strong>Gate Access Clickers Issued:</strong> {resident?.gate_clickers_count ?? 0}</p>
              <p style={{ marginTop: 8 }}><strong>Mailbox Keys Issued:</strong> {resident?.mailbox_keys_count ?? 0}</p>
              <p style={{ marginTop: 8 }}><strong>Mailbox #:</strong> {resident?.mailbox_number || "Not yet assigned"}</p>

              <p style={{ color: "var(--gray)", fontSize: 12, marginTop: 12 }}>
                Lost or damaged items may be subject to a replacement fee — contact the office for details.
              </p>
            </div>
          ) : (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Edit Pets</h2>
              {petRestrictions.trim() && (
                <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap" }}>
                  ⚠️ {petRestrictions}
                </div>
              )}
              {/* Oct 19 (per Mely): only the box is clickable, not the text. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  style={{ cursor: "pointer", width: 16, height: 16, margin: 0 }}
                  checked={petsAllowedInput}
                  onChange={(e) => setPetsAllowedInput(e.target.checked)}
                />
                <span>I have pet(s)</span>
              </div>
              {petsAllowedInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>How many pets?</label>
                    <select
                      value={String(petDetailsInput.length)}
                      onChange={(e) => {
                        const n = Number(e.target.value) || 0;
                        setPetDetailsInput((prev) => Array.from({ length: n }, (_, i) => prev[i] || { ...emptyPortalPet }));
                      }}
                      style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%", background: "#fff" }}
                    >
                      {[0, 1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={String(n)}>{n}</option>
                      ))}
                    </select>
                  </div>
                  {petDetailsInput.map((pet, i) => {
                    const update = (patch: Partial<PortalPet>) =>
                      setPetDetailsInput((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
                    const inputStyle = { border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" } as const;
                    const lbl = { fontSize: 12, color: "var(--gray)" } as const;
                    return (
                      <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                        <strong style={{ fontSize: 13 }}>Pet {i + 1}</strong>
                        <div><label style={lbl}>Type</label><input style={inputStyle} placeholder="e.g. Dog, Cat" value={pet.type} onChange={(e) => update({ type: e.target.value })} /></div>
                        <div><label style={lbl}>Name of your pet</label><input style={inputStyle} value={pet.name} onChange={(e) => update({ name: e.target.value })} /></div>
                        <div><label style={lbl}>Breed</label><input style={inputStyle} value={pet.breed} onChange={(e) => update({ breed: e.target.value })} /></div>
                        <div><label style={lbl}>Color</label><input style={inputStyle} value={pet.color} onChange={(e) => update({ color: e.target.value })} /></div>
                        <div><label style={lbl}>Weight (lbs)</label><input style={inputStyle} inputMode="numeric" value={pet.weight} onChange={(e) => update({ weight: e.target.value })} /></div>
                        <div>
                          <label style={lbl}>Provided shots records?</label>
                          <select style={{ ...inputStyle, background: "#fff" }} value={pet.shots_provided} onChange={(e) => update({ shots_provided: e.target.value as PortalPet["shots_provided"] })}>
                            <option value="">Select...</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>The park office is notified whenever you update this information.</p>
              <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={savePets} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Save</button>
                <button onClick={() => { setEditingPets(false); setPetsMessage(""); }} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                {petsMessage && <p style={{ fontSize: 13, color: petsMessage.startsWith("Could not") ? "#dc2626" : "#16a34a" }}>{petsMessage}</p>}
              </div>
            </div>
          )}
              </div>
              <div className="rp-links">
            <button id="documents" className="rp-anchor" onClick={() => router.push("/residents/documents")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>📄 Documents</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>View and print your signed lease agreement and any signed resident agreements.</p>
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
              </div>
              {activeLease?.requested_move_out_date && (
                <p style={{ fontSize: 13, color: "var(--gray)", margin: 0 }}>
                  Requested move-out date: <strong>{activeLease.requested_move_out_date}</strong> <span style={{ color: "#16a34a", fontWeight: 700 }}>Submitted ✓</span>
                </p>
              )}
            </>)}

            {section === "household" && (<>
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
                  {(() => {
                    const a = calculateAge(occDateOfBirth);
                    if (a === null || a < 18) return null;
                    return (
                      <div style={{ gridColumn: "span 2" }}>
                        <label style={{ fontSize: 12, color: "var(--gray)" }}>
                          Social Security # {editingVisitorId ? "(leave blank to keep the one on file)" : "(required for adults 18+)"}
                        </label>
                        <input
                          placeholder="123-45-6789"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={11}
                          value={occSsn}
                          onChange={(e) => {
                            const d = e.target.value.replace(/\D/g, "").slice(0, 9);
                            setOccSsn(d.length <= 3 ? d : d.length <= 5 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`);
                          }}
                          style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }}
                        />
                        <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 4 }}>
                          Email is also required for adults. Stored securely; the office only sees the last 4 digits.
                        </p>
                      </div>
                    );
                  })()}
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
                  {/* Oct 19 (per Mely): show the date of birth the way it was entered (mm/dd/yyyy) */}
                  {person.date_of_birth && (
                    <p style={{ color: "var(--gray)", fontSize: 12 }}>
                      Date of Birth: {(() => {
                        const m = String(person.date_of_birth).match(/^(\d{4})-(\d{2})-(\d{2})/);
                        return m ? `${m[2]}/${m[3]}/${m[1]}` : String(person.date_of_birth);
                      })()}
                      {age !== null ? ` · Age: ${age}` : ""}
                    </p>
                  )}
                  {!person.date_of_birth && age !== null && <p style={{ color: "var(--gray)", fontSize: 12 }}>Age: {age}</p>}
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
          <div id="visitors-section" style={card}>
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
              <div id="vehicles" className="rp-anchor">
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
              </div>
              <div id="golf-carts" className="rp-anchor">
          {resident && (
            <GolfCartCard
              resident={resident}
              maxCarts={golfCartsMax}
              insuranceRequired={golfCartInsuranceRequired}
              onSaved={loadResidentDashboard}
            />
          )}
              </div>
            </>)}

            {section === "requests" && (<>
              <div id="maintenance" className="rp-anchor">
          {maintenanceEnabled && (
          <div onClick={() => router.push("/residents/maintenance")} style={{ ...card, cursor: "pointer" }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>Maintenance Requests</h2>
            <p style={{ color: "var(--gray)", fontSize: 13 }}>Report issues and track maintenance progress.</p>
          </div>
          )}
          {!requestsVisible && (
            <div style={card}><p style={{ color: "var(--gray)", fontSize: 13 }}>Maintenance requests are handled by the office — please call or message us.</p></div>
          )}
              </div>
              {openMaintenance.length > 0 && (
                <div style={card}>
                  <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Open Requests</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {openMaintenance.slice(0, 5).map((r: any) => (
                      <button key={r.id} type="button" className="rp-attn-row" onClick={() => router.push("/residents/maintenance")}>
                        <span className="rp-attn-text"><b>{r.subject || "Maintenance request"}</b><small>{r.status}{r.priority ? ` · ${r.priority} priority` : ""}</small></span>
                        <span className="rp-attn-go">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div id="propane" className="rp-anchor">
          {propaneOrders.length > 0 && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>⛽ Propane Orders</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {propaneOrders.map((order) => (
                  <div
                    key={order.id}
                    style={{ border: "1.5px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", gap: 16, alignItems: "center" }}
                  >
                    {/* Oct 26 (security review): orders matched only by email come without the QR code. */}
                    {order.qr_token ? (
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(order.qr_token)}`}
                        alt="Propane pickup QR code"
                        style={{ width: 100, height: 100, flexShrink: 0 }}
                      />
                    ) : null}
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
              </div>
            </>)}

            {section === "messages" && (<>
              <div id="notifications" className="rp-anchor" style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>🔔 Notifications</h2>
                {notifications.length === 0 ? (
                  <p style={{ color: "var(--gray)", fontSize: 13 }}>Nothing yet.</p>
                ) : (
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                    {notifications.map((n) => notifRow(n, !n.resident_read_at || freshNotifIds.has(String(n.id))))}
                  </div>
                )}
              </div>
              <div id="announcements" className="rp-anchor">
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
              </div>
              {announcements.length === 0 && (
                <div style={card}><p style={{ color: "var(--gray)", fontSize: 13 }}>No announcements from the park right now.</p></div>
              )}
            </>)}

            {section === "info" && <ParkInfoSection data={parkInfo} />}

            {section === "more" && (<>
              <InstallApp appName={resident?.companies?.company_name || "resident"} accent="#0f5132" />
              <div className="rp-more-list">
                {(["household", "requests", "info"] as SectionId[]).filter((id) => id !== "requests" || requestsVisible).map((id) => {
                  const x = SECTIONS.find((s) => s.id === id)!;
                  return <button key={id} type="button" onClick={() => openSection(id)}><NavIcon d={x.icon} /><span>{x.label}</span><Badge n={badge[id]} /><span className="rp-attn-go">→</span></button>;
                })}
              </div>
              <div id="profile" className="rp-anchor">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {!editingResidentInfo ? (
              <div id="resident-info" style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>Resident Information</h2>
                  <button onClick={openEditResidentInfo} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                </div>
                <p><strong>Email:</strong> {resident.email || "No email"}</p>
                <p style={{ marginTop: 8 }}><strong>Phone:</strong> {resident.phone || "No phone"}</p>
                <SmsAlertsToggle residentId={resident.id} parkName={resident?.companies?.company_name || ""} phone={resident.phone} />
              </div>
            ) : (
              <div id="resident-info" style={card}>
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
              <div id="emergency-contact" style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>Emergency Contact</h2>
                  <button onClick={openEditEmergencyContact} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Edit</button>
                </div>
                <p><strong>Name:</strong> {resident.emergency_contact_name || "None"}</p>
                <p><strong>Phone:</strong> {resident.emergency_contact_phone || "None"}</p>
                <p><strong>Relationship:</strong> {resident.emergency_contact_relationship || "None"}</p>
              </div>
            ) : (
              <div id="emergency-contact" style={card}>
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
              </div>
              <div id="marketplace" className="rp-links">
            <button onClick={() => router.push("/residents/marketplace")} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>🛍️ Marketplace</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>Buy and sell with your neighbors.</p>
            </button>
              </div>
              <div>
                <button onClick={logout} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  Sign Out
                </button>
              </div>
            </>)}

            {/* Oct 28 (per Mely): pay by bank (ACH) or card — shown only when bank payment is offered. */}
          {showPayChoice && feeRates && (
            <div
              onClick={() => !startingPayment && setShowPayChoice(false)}
              style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="pay-choice-title"
                onClick={(e) => e.stopPropagation()}
                style={{ ...card, maxWidth: 440, width: "100%", position: "relative" }}
              >
                <button
                  onClick={() => setShowPayChoice(false)}
                  disabled={startingPayment}
                  style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--gray)" }}
                  aria-label="Close"
                >
                  ✕
                </button>
                <h2 id="pay-choice-title" style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>How would you like to pay?</h2>
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 14 }}>{payScope === "ahead" ? "Paying ahead" : "Balance"}: <strong>{money(payAmount)}</strong></p>
                {/* Oct 28 (per Mely): bank is listed first, recommended and preselected; the resident
                    picks one and continues. */}
                <div role="radiogroup" aria-label="Payment method" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {([
                    {
                      v: "ach" as const,
                      title: "Pay by bank (ACH)",
                      sub: `${achFee > 0 ? `fee ${money(achFee)}` : "no fee"}${cardFee > achFee ? ` — ${money(cardFee - achFee)} less than card` : ""} · clears in 3–5 business days`,
                      badge: cardFee > achFee ? "Recommended · lowest fee" : "Recommended",
                    },
                    { v: "card" as const, title: "Pay by card", sub: `${cardFee > 0 ? `fee ${money(cardFee)}` : "no fee"} · paid instantly`, badge: "" },
                  ]).map((o) => (
                    <label
                      key={o.v}
                      style={{
                        display: "flex", gap: 10, alignItems: "flex-start", cursor: startingPayment ? "default" : "pointer", borderRadius: 6, padding: "12px 14px",
                        border: payMethodChoice === o.v ? "2px solid #16a34a" : "2px solid var(--border)",
                        background: payMethodChoice === o.v ? "#d3f8e2" : "#fff", opacity: startingPayment ? 0.6 : 1,
                      }}
                    >
                      <input type="radio" name="pay-method" checked={payMethodChoice === o.v} disabled={startingPayment} onChange={() => setPayMethodChoice(o.v)} style={{ marginTop: 3 }} />
                      <span style={{ display: "block" }}>
                        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontWeight: 800 }}>
                          {o.title}
                          {o.badge && <span style={{ background: "#16a34a", color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{o.badge}</span>}
                        </span>
                        <span style={{ display: "block", fontSize: 13, color: o.v === "ach" ? "#14532d" : "var(--gray)" }}>{o.sub}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p style={{ color: "#b45309", fontSize: 12, marginTop: 12, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                  {returnedFeeSentence(feeRates.returnFeePhrase)}
                </p>
                <button
                  onClick={() => startPayment(payMethodChoice, payScope)}
                  disabled={startingPayment}
                  style={{ marginTop: 12, width: "100%", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: 14, fontWeight: 800, cursor: startingPayment ? "default" : "pointer", opacity: startingPayment ? 0.6 : 1 }}
                >
                  {payMethodChoice === "ach" ? "Continue to pay by bank" : "Continue to pay by card"}
                </button>
                {startingPayment && <p style={{ fontSize: 13, marginTop: 8, color: "var(--gray)" }}>Opening secure payment…</p>}
              </div>
            </div>
          )}

            {/* Move-out request (modal — opened from My lot & home, or #move-out) */}
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
          </div>
        </div>

        <nav className="rp-tabbar" aria-label="Resident portal">
          {MOBILE_TABS.map((id) => {
            const x = SECTIONS.find((s) => s.id === id)!;
            const on = section === id || (id === "more" && UNDER_MORE.includes(section));
            return (
              <button key={id} type="button" className={on ? "on" : ""} onClick={() => openSection(id)} aria-current={on ? "page" : undefined}>
                <NavIcon d={x.icon} /><span>{x.short}</span><Badge n={id === "more" ? moreTabBadge : badge[id]} />
              </button>
            );
          })}
        </nav>
      </section>
    </>
  );
}
