"use client";
import InstallApp, { AppBadge } from "@/components/InstallApp";
import SmsAlertsToggle from "@/components/SmsAlertsToggle";
import { portalConfirm, portalAlert } from "@/components/portalDialog";
import GolfCartCard from "@/components/GolfCartCard";
import { useState, useEffect } from "react";
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
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import RecHallCard, { fetchRecHallOn } from "@/components/RecHallCard";
import { usePortalLang, adoptSavedPortalLang } from "@/lib/portalI18n";
import {
  SECTIONS, ANCHORS, sectionFor, filterSubItems, requestsVisible as requestsVisibleFor, subKey, subPageHref, visibleSections,
  NavIcon, ResidentSideNav, ResidentSubChips, ResidentTabBar, SaveNavContext,
  type SectionId, type SubItem, type NavFlags,
} from "@/components/ResidentPortalNav";

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
// Oct 30: sections, sub-menus and the menu components live in components/ResidentPortalNav.tsx,
// shared with the portal sub-pages (Invoices, Payment history, Electric history…).

// Oct 29 (i18n): inline messages are translated when set, so their color can't be read from the
// English text any more. BAD (an invisible zero-width space) marks an error message (shown red).
const BAD = "\u200B";
const SUBMITTED = "Submitted ✓";

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
  // Oct 29 (per the owner): the portal in English / Spanish / Portuguese (src/lib/portalI18n.ts).
  // `money`: the same USD amount, formatted for the resident's language.
  const { lang, t, tp, st, money, date, dateTime, dateLabel, err, returnedFeeSentence } = usePortalLang();
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
  // Oct 29 (per Mely): "Request the Rec Hall" (Requests section) — only while the admin's Rec Hall switch is on.
  const [recHallOn, setRecHallOn] = useState(false);
  useEffect(() => { if (residentId) fetchRecHallOn(residentId).then(setRecHallOn); }, [residentId]);
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
    // The language saved on the account (if the column exists) — only when this browser has no choice yet.
    // Oct 29: column exists but empty + this browser chose ES/PT → saved once (phone alerts use it).
    if (residentData) adoptSavedPortalLang(residentData.portal_language, residentId);

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
      setMessage(profileError === "Failed to load profile." ? "Failed to load profile." : "Resident not found.");
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
      void portalAlert(err(data.error) || t("Could not start payment."));
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
      setMoveOutMessage(t("Please choose a date first."));
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
        setMoveOutMessage(t("Error: {detail}", { detail: err(result.error) }));
      } else {
        setMoveOutMessage(SUBMITTED);
        setActiveLease((prev: any) => ({
          ...prev,
          requested_move_out_date: moveOutDate,
          requested_move_out_note: moveOutNote,
        }));
      }
    } catch {
      setMoveOutMessage(t("Something went wrong. Please try again."));
    }
    setMoveOutSubmitting(false);
  }

  async function handleCancelMoveOut() {
    if (!(await portalConfirm(t("Cancel your move-out request? You can submit a new date afterward."), { danger: true }))) return;
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
        setMoveOutMessage(t("Error: {detail}", { detail: err(result.error) }));
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
      setMoveOutMessage(t("Something went wrong. Please try again."));
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
        setResidentInfoMessage(BAD + t("Could not save changes: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }

      setEditingResidentInfo(false);
      loadResidentDashboard();
    } catch (e: any) {
      setResidentInfoMessage(BAD + t("Could not save changes (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
  }

  // Aug 11 (per Mely): the only self-editable field in the otherwise
  // read-only "Parking & Pets" card — residents get new pets over time and
  // should be able to update this themselves. Notifies the admin (see
  // /api/portal/save-pets).
  async function savePets() {
    setPetsMessage("");
    if (petsAllowedInput && petDetailsInput.length === 0) {
      setPetsMessage(BAD + t("Please select how many pets you have."));
      return;
    }
    if (
      petsAllowedInput &&
      petDetailsInput.some((p) => !p.type.trim() || !p.name.trim() || !p.breed.trim() || !p.color.trim() || !p.weight.trim() || !p.shots_provided)
    ) {
      setPetsMessage(BAD + t("Please fill in type, name, breed, color, weight, and shots records for each pet."));
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
        setPetsMessage(BAD + t("Could not save pets: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }

      setEditingPets(false);
      loadResidentDashboard();
    } catch (e: any) {
      setPetsMessage(BAD + t("Could not save pets (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
        setEmergencyContactMessage(BAD + t("Could not save changes: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }

      setEditingEmergencyContact(false);
      loadResidentDashboard();
    } catch (e: any) {
      setEmergencyContactMessage(BAD + t("Could not save changes (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
  }

  async function addOccupant() {
    setOccupantMessage("");
    if (!occFullName.trim()) {
      setOccupantMessage(BAD + t("Please enter a full name."));
      return;
    }
    // Mely asked (Aug 2) that Stay Start/End Date be required before a
    // visitor can be saved, not just optional.
    if (occType === "visitor" && (!occStayStart || !occStayEnd)) {
      setOccupantMessage(BAD + t("Please enter both a Stay Start Date and Stay End Date."));
      return;
    }
    // Aug 4 (per Mely): Date of Birth is required for Household Occupants
    // — it's how the system knows whether a background check is legally
    // required (18+) before move-in is compliant.
    if (occType === "household" && !occDateOfBirth) {
      setOccupantMessage(BAD + t("Please enter this person's Date of Birth."));
      return;
    }
    // Oct 19 (per Mely — Aloha's paper application): adults (18+) living
    // here must give their own email and Social Security number. When
    // editing, the SSN can be left blank to keep the one already on file.
    const occAge = calculateAge(occDateOfBirth);
    const occIsAdult = occType === "household" && occAge !== null && occAge >= 18;
    const occSsnDigits = occSsn.replace(/\D/g, "");
    if (occIsAdult && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(occEmail.trim())) {
      setOccupantMessage(BAD + t("Please enter a valid email for this adult (18+)."));
      return;
    }
    if (occIsAdult && !editingVisitorId && occSsnDigits.length !== 9) {
      setOccupantMessage(BAD + t("Please enter this adult's Social Security # (9 digits)."));
      return;
    }
    if (occIsAdult && editingVisitorId && occSsnDigits.length > 0 && occSsnDigits.length !== 9) {
      setOccupantMessage(BAD + t("Social Security # must be 9 digits (or leave it blank to keep the one on file)."));
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
        setOccupantMessage(BAD + t(editingVisitorId ? "Could not update visitor: {detail}" : "Could not add: {detail}", { detail: err(result?.error) || res.status }));
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
    } catch (e: any) {
      setOccupantMessage(BAD + t("Could not save (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
    if (!(await portalConfirm(t("Remove this person?"), { danger: true }))) return;
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
        setOccupantMessage(BAD + t("Could not remove: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }

      loadResidentDashboard();
    } catch (e: any) {
      setOccupantMessage(BAD + t("Could not remove (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
  }

  async function addVehicle() {
    setVehicleMessage("");
    if (!vehPlate.trim()) {
      setVehicleMessage(BAD + t("Please enter a license plate."));
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
        setVehicleMessage(BAD + t(editingVehicleId ? "Could not update vehicle: {detail}" : "Could not add vehicle: {detail}", { detail: err(result?.error) || res.status }));
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
    } catch (e: any) {
      setVehicleMessage(BAD + t("Could not save vehicle (unexpected error): {detail}", { detail: e?.message || String(e) }));
    }
  }

  async function deleteVehicle(vehicleId: string) {
    const confirmed = await portalConfirm(t("Remove this vehicle?"));
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
        setVehicleMessage(BAD + t("Could not remove vehicle: {detail}", { detail: err(result?.error) || res.status }));
        return;
      }
      loadResidentDashboard();
    } catch (e: any) {
      setVehicleMessage(BAD + t("Could not remove vehicle (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
        setRvMessage(BAD + t("Could not save RV info: {detail}", { detail: err(result?.error) || res.status }));
      } else {
        setRvMessage(t("RV info saved."));
        setEditingRvInfo(false);
        loadResidentDashboard(); // Oct 26: refresh so the "add your home info" reminder clears right away
      }
    } catch (e: any) {
      setRvMessage(BAD + t("Could not save RV info (unexpected error): {detail}", { detail: e?.message || String(e) }));
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
  // Oct 30 (per Mely): a STORAGE-ONLY customer (rents an RV storage space, doesn't live in the park)
  // gets a reduced portal: Home, Payments, Messages, Park info, Profile — nothing about a lot.
  const isStorage = String(resident?.account_type || "") === "storage";
  const navFlags: NavFlags = { maintenance: maintenanceEnabled, propane: propaneOrders.length > 0, recHall: recHallOn, storage: isStorage };
  const allowSection = (id: SectionId | null): SectionId => (id && (!isStorage || visibleSections(navFlags).includes(id)) ? id : "home");
  useEffect(() => {
    if (!residentLoaded) return;
    const go = () => {
      const h = window.location.hash.replace("#", "");
      setSection(allowSection(sectionFor(h)));
      // Oct 30: a storage-only account has no lease to move out of (the server refuses it too).
      if ((h === "move-out" || h === "move-out-request") && !isStorage) setShowMoveOutModal(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residentLoaded, isStorage]);
  // Oct 30 (per Mely — the menu in sync with what's on the right): highlight the sub item for the
  // address (#charges…) and, while scrolling, the part of the section that's on screen.
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const spyKeys = residentLoaded ? subItems(section).filter((it) => it.anchor && !it.href).map((it) => it.anchor!).join(",") : "";
  useEffect(() => {
    const anchors = spyKeys ? spyKeys.split(",") : [];
    let raf = 0;
    const spy = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = window.location.hash.replace("#", "");
        const hashSub = anchors.includes(h) ? h : null;
        const els = anchors.map((a) => [a, document.getElementById(a)] as const).filter(([, el]) => el && el.offsetParent !== null) as [string, HTMLElement][];
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        let cur: string | null = null;
        if (window.scrollY >= 8) {
          for (const [a, el] of els) {
            const top = el.getBoundingClientRect().top;
            if (top <= 160 || (atBottom && top < window.innerHeight)) cur = a;
          }
        }
        setActiveSub(cur || hashSub);
      });
    };
    spy();
    if (!anchors.length) return () => cancelAnimationFrame(raf);
    window.addEventListener("scroll", spy, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", spy); };
  }, [spyKeys, section]);
  function subItems(id: SectionId): SubItem[] {
    return filterSubItems(id, navFlags);
  }
  function openSub(it: SubItem) {
    if (it.href) { router.push(subPageHref(it.href, section)); return; }
    if (!it.anchor) return;
    setActiveSub(subKey(it));
    if (window.location.hash.replace("#", "") === it.anchor) {
      if (it.anchor === "move-out" && !isStorage) setShowMoveOutModal(true);
      const el = document.getElementById(it.anchor);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
      return;
    }
    window.location.hash = it.anchor;
  }
  // Oct 29 (per Mely): clicking the section you're already in folds/unfolds its sub-menu.
  const [subFolded, setSubFolded] = useState<SectionId | null>(null);
  function openSection(id: SectionId) {
    if (section === id && subItems(id).length > 0) { setSubFolded((f) => (f === id ? null : id)); return; }
    setSubFolded(null);
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
        <p>{t(message)}</p>
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
  // Oct 29: the failure notice is a resident_facing row (lib/rvCardAutopay.ts / rvBankAutopay.ts) and a
  // failure TURNS AUTOPAY OFF — so it shows while autopay is still off, there's a balance, and it's recent
  // (turning autopay back on, or paying, clears it).
  const lastAutopayNotice = notifications.find((n: any) => n.update_type === "autopay_failed" || n.update_type === "autopay_charged");
  const autopayFailed = !autopayEnabled && outstandingBalance > 0 && lastAutopayNotice?.update_type === "autopay_failed"
    && Date.now() - Date.parse(lastAutopayNotice.created_at || "") < 45 * 86400000;
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
    attention.push({ key: "od", text: tp(overdueInvoices.length, "{n} overdue invoice", "{n} overdue invoices"), sub: t("{amount} past due", { amount: money(overdueTotal) }), tone: "bad", go: "pay", anchor: "charges" });
  } else if (pendingInvoices.length) {
    attention.push({ key: "due", text: t("Balance due: {amount}", { amount: money(outstandingBalance) }), sub: nextPaymentDate ? t("Next payment due {date}", { date: dateLabel(nextPaymentDate) }) : tp(pendingInvoices.length, "{n} invoice to pay", "{n} invoices to pay"), tone: "warn", go: "pay", anchor: "charges" });
  }
  if (autopayFailed) attention.push({ key: "ap", text: t(autopayMethod === "ach" ? "Autopay could not take the bank payment" : "Autopay could not charge your card"), sub: t(autopayMethod === "ach" ? "Pay by hand or set up autopay again" : "Update your card or pay by hand"), tone: "bad", go: "pay", anchor: "autopay" });
  for (const p of bgTodo) {
    attention.push(p.has_id_uploaded
      ? { key: "bg" + p.id, text: t("Background check needed"), sub: t("{name} — ID received, start the check", { name: p.full_name }), tone: "bad", go: "household", href: "/residents/background-checks" }
      : { key: "id" + p.id, text: t("Photo ID needed"), sub: t("{name} is 18+ — upload an ID, then the background check", { name: p.full_name }), tone: "bad", go: "household", href: `/residents/documents?forOccupant=${p.id}` });
  }
  if (!bgTodo.length && pendingBgChecks.length) attention.push({ key: "bgp", text: t("Background check needed"), sub: tp(pendingBgChecks.length, "{n} household occupant", "{n} household occupants"), tone: "bad", go: "household", href: "/residents/background-checks" });
  const addendaToSign = leaseAddenda.filter((a) => a.status === "pending");
  for (const a of addendaToSign) attention.push({ key: "la" + a.id, text: t("Please sign: {title}", { title: a.title }), sub: t("Review and sign it online — it takes a minute"), tone: "warn", go: "home", anchor: "lease-addendum" });
  if (billOfSaleToSign && !isStorage) attention.push({ key: "bos", text: t("Sign your Bill of Sale"), sub: t("Your Rent-to-Own home is paid off"), tone: "warn", go: "lot", anchor: "rent-to-own" });
  if (rvInfoMissing && !isStorage) attention.push({ key: "rv", text: t("Add your home/unit info"), sub: t("Make, model and VIN / Tag #"), tone: "warn", go: "lot", anchor: "home-info" });
  if (emergencyMissing) attention.push({ key: "ec", text: t("Add an emergency contact"), tone: "warn", go: "more", anchor: "profile" });
  if (petsNoShots.length && !isStorage) attention.push({ key: "pets", text: t("Pet shots records not provided"), sub: petsNoShots.map((p: any) => p.name || t("Pet")).join(", "), tone: "warn", go: "lot", anchor: "parking-pets" });
  if (propaneReady.length && !isStorage) attention.push({ key: "pr", text: tp(propaneReady.length, "{n} propane order ready for pickup", "{n} propane orders ready for pickup"), sub: t("Show the QR code to staff"), tone: "info", go: "requests", anchor: "propane" });
  if (unreadNotifs.length) attention.push({ key: "nt", text: tp(unreadNotifs.length, "{n} new notification", "{n} new notifications"), sub: err(unreadNotifs[0]?.message), tone: "info", go: "messages" });

  const badge: Partial<Record<SectionId, number>> = {
    pay: pendingInvoices.length + (autopayFailed ? 1 : 0),
    lot: isStorage ? 0 : (billOfSaleToSign ? 1 : 0) + (rvInfoMissing ? 1 : 0) + (petsNoShots.length ? 1 : 0),
    household: isStorage ? 0 : bgTodo.length || pendingBgChecks.length,
    requests: isStorage ? 0 : propaneReady.length,
    messages: unreadNotifs.length,
    more: emergencyMissing ? 1 : 0,
  };
  const moreTabBadge = (badge.household || 0) + (badge.requests || 0) + (badge.more || 0);
  const Badge = ({ n }: { n?: number }) => (n ? <span className="rp-nav-badge">{n}</span> : null);
  const sectionTitle = t(SECTIONS.find((x) => x.id === section)?.label || "");
  // Oct 28 (per Mely): Requests holds maintenance (if the park turned it on) and propane orders.
  // Nothing to show there → hide the Requests nav item too.
  const requestsVisible = requestsVisibleFor(navFlags);
  const navSections = isStorage ? SECTIONS.filter((x) => visibleSections(navFlags).includes(x.id)) : SECTIONS.filter((x) => x.id !== "requests" || requestsVisible);
  const storageSpacesText = (Array.isArray(resident?.storage_spaces) ? resident.storage_spaces : []).join(", ");
  function goTo(item: { go: SectionId; anchor?: string }) {
    if (item.anchor) { window.location.hash = item.anchor; return; }
    openSection(item.go);
  }

  const Tile = ({ go, h, lines, cta = t("View all"), anchor }: { go: SectionId; h: string; lines: (string | null | false | undefined)[]; cta?: string; anchor?: string }) => (
    <button type="button" className="rp-tile" onClick={() => goTo({ go, anchor })}>
      <span className="rp-tile-h">{h}<Badge n={anchor ? undefined : badge[go]} /></span>
      {lines.filter(Boolean).map((l, n) => <span key={n} className={n === 0 ? "rp-tile-main" : "rp-tile-line"}>{l}</span>)}
      <span className="rp-tile-cta">{cta} →</span>
    </button>
  );

  const rtoLine = rentToOwnPlan
    ? rentToOwnPlan.status === "pending_signatures"
      ? t("Rent-to-Own paid off — Bill of Sale")
      : t("Rent-to-Own: {paid} of {total}", { paid: money(Number(rentToOwnPlan.paid_so_far || 0)), total: money(Number(rentToOwnPlan.total_price || 0)) })
    : null;

  // Grace period after the due date (Lease Defaults) — shown on Home and in Pay.
  const graceNote = (() => {
    if (!lateGrace.on || !nextPaymentDate) return null;
    const d = new Date(nextPaymentDate);
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + lateGrace.days);
    return (
      <span style={{ display: "block", fontSize: 12, color: "var(--gray)", fontWeight: 400 }}>
        {lateGrace.days > 0
          ? tp(lateGrace.days, "Grace period: {n} day, until the end of {date}. A late fee applies after that date.", "Grace period: {n} days, until the end of {date}. A late fee applies after that date.", { date: date(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) })
          : t("No grace period: a late fee applies after the due date.")}
      </span>
    );
  })();

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
                        <div>{err(n.message)}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                          {dateTime(n.created_at, { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })}
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
                        title={t("Dismiss")}
                        aria-label={t("Dismiss")}
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
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#d3f8e2", fontWeight: 600, marginBottom: 8 }}>{t("Resident Portal")}</div>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, marginBottom: 4 }}>{section === "home" ? t("Welcome, {name}", { name: resident.full_name }) : sectionTitle}</h1>
            <p style={{ color: "#000000", fontSize: 14 }}>{isStorage ? (storageSpacesText ? t("Storage space {name}", { name: storageSpacesText }) : (resident.companies?.company_name || "")) : resident.rv_lots?.lot_name ? t("Lot {name}", { name: resident.rv_lots.lot_name }) : (resident.companies?.company_name || "")}</p>
            <ResidentPushAlerts residentId={residentId} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", flexWrap: "wrap" }}>
            {/* Oct 29 (per the owner): EN / ES / PT — saved in this browser and on the account */}
            <PortalLangSwitcher residentId={residentId} />
            <button
              aria-label={t("Notifications")}
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
                  <strong style={{ fontSize: 13 }}>{t("Notifications")}</strong>
                </div>
                {notifications.length === 0 ? (
                  <p style={{ padding: 16, fontSize: 13, color: "#6b7280" }}>{t("Nothing yet.")}</p>
                ) : (
                  notifications.map((n) => notifRow(n, !n.resident_read_at))
                )}
              </div>
            )}
            <button onClick={logout} style={{ background: "transparent", border: "1.5px solid #000000", color: "#000000", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
              {t("Sign Out")}
            </button>
          </div>
        </div>
      </section>

      <section className="rp-wrap">
        <div className="rp-portal">
          <ResidentSideNav sections={navSections.map((x) => x.id)} section={section} subFolded={subFolded} activeSub={activeSub} subItems={subItems} badge={badge} onSection={openSection} onSub={openSub} />
          <SaveNavContext flags={navFlags} badge={badge} moreBadge={moreTabBadge} />

          <AppBadge n={attention.length} />
          <div className="rp-main">
            {section !== "home" && <ResidentSubChips items={subItems(section)} activeSub={activeSub} onSub={openSub} />}
            {/* Oct 26 (per Mely): inside a section, show what the red number means — tap one to go
                straight to it. The number goes away by itself once it's done. */}
            {section !== "home" && message === "" && attention.some((a) => a.go === section) && (
              <div className="rp-attn">
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("To do here")}</h2>
                {attention.filter((a) => a.go === section).map((a) => {
                  const body = (<><span className={`rp-attn-dot ${a.tone}`} /><span className="rp-attn-text"><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span><span className="rp-attn-go">→</span></>);
                  return a.href
                    ? <button key={a.key} type="button" className="rp-attn-row" onClick={() => router.push(subPageHref(a.href!, a.go))}>{body}</button>
                    : <button key={a.key} type="button" className="rp-attn-row" onClick={() => goTo(a)}>{body}</button>;
                })}
                <p style={{ fontSize: 13, color: "#64748b", margin: "8px 0 0" }}>{t("The red number goes away as soon as each item is done.")}</p>
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
                  <div style={label}>{t("Outstanding Balance")}</div>
                  <div className="rp-balance-big" style={{ color: outstandingBalance > 0 ? "#b91c1c" : "var(--green)" }}>{money(outstandingBalance)}</div>
                  {overdueInvoices.length > 0 ? (
                    <div style={{ color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{t("{amount} overdue", { amount: money(overdueTotal) })}</div>
                  ) : nextPaymentDate ? (
                    <div style={{ color: "var(--gray)", fontSize: 13 }}>{t("Next Payment (Due Date):")} <strong>{dateLabel(nextPaymentDate)}</strong>{graceNote}</div>
                  ) : null}
                  {processingTotal > 0 && (
                    <div style={{ color: "#1e40af", fontWeight: 700, fontSize: 13 }}>{t("{amount} bank payment processing · clears in 3–5 business days", { amount: money(processingTotal) })}</div>
                  )}
                  {payAheadTotal > 0 && (
                    <div style={{ color: "#166534", fontSize: 13 }}>{t("Next month's invoice is ready ({amount}) —", { amount: money(payAheadTotal) })} <button type="button" className="rp-link-btn" onClick={() => openSection("pay")}>{t("pay ahead (optional)")}</button></div>
                  )}
                </div>
                <div className="rp-balance-btns">
                  {acceptOnlinePayments && outstandingBalance > 0 && (
                    <button onClick={handlePayNow} style={{ background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                      {t("Pay Now")}
                    </button>
                  )}
                  <button type="button" className="rp-link-btn" onClick={() => openSection("pay")}>{pendingInvoices.length ? t("See charges") : t("Payments")} →</button>
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
                  <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("Needs your attention")}</h2>
                  {attention.map((a) => {
                    const body = (<><span className={`rp-attn-dot ${a.tone}`} /><span className="rp-attn-text"><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span><span className="rp-attn-go">→</span></>);
                    return a.href
                      ? <button key={a.key} type="button" className="rp-attn-row" onClick={() => router.push(subPageHref(a.href!, a.go))}>{body}</button>
                      : <button key={a.key} type="button" className="rp-attn-row" onClick={() => goTo(a)}>{body}</button>;
                  })}
                </div>
              ) : (
                <div className="rp-allset" role="status">{t("✓ You're all set. Nothing needs your attention right now.")}</div>
              ))}

              <InstallApp appName={resident?.companies?.company_name || "resident"} accent="#0f5132" compact portal />
              <div className="rp-tiles">
                <Tile go="pay" h={t("Payments")} lines={[
                  pendingInvoices.length ? tp(pendingInvoices.length, "{amount} due · {n} invoice", "{amount} due · {n} invoices", { amount: money(outstandingBalance) }) : t("All paid up"),
                  nextPaymentDate && t("Next payment {date}", { date: dateLabel(nextPaymentDate) }),
                  autopayAvailable && (autopayEnabled ? `${t("Autopay on")}${autopayCardLast4 ? ` · ${t(autopayMethod === "ach" ? "bank" : "card")} •••• ${autopayCardLast4}` : ""}` : t("Autopay off")),
                ]} />
                {isStorage ? (
                  <Tile go="more" anchor="storage-info" h={t("My storage")} cta={t("Details")} lines={[
                    storageSpacesText ? t("Storage space {name}", { name: storageSpacesText }) : t("Storage"),
                    resident.storage_active === false ? t("Storage ended") : Number(resident.storage_monthly) > 0 ? t("{amount} per month", { amount: money(Number(resident.storage_monthly)) }) : null,
                  ]} />
                ) : (
                <Tile go="lot" h={t("My lot & home")} lines={[
                  resident.rv_lots?.lot_name ? t("Lot {name}", { name: resident.rv_lots.lot_name }) : (resident.companies?.company_name || t("My lot")),
                  rvInfoMissing ? t("Home/unit info not added yet") : `${t(rvType || "RV")} — ${[rvYear, rvMake, rvModel].filter(Boolean).join(" ")}`,
                  rtoLine || (activeLease?.requested_move_out_date ? t("Move-out requested: {date}", { date: date(activeLease.requested_move_out_date) }) : null),
                ]} />
                )}
                {!isStorage && electricUsage.length > 0 && (
                  <Tile go="pay" anchor="electric" h={t("Electric usage")} cta={t("Details")} lines={[
                    `${dateLabel(electricUsage[0]?.billing_month || "")} · ${electricUsage[0]?.current_reading || 0} kWh`,
                    t("Electric Charge {amount}", { amount: money(Number(electricUsage[0]?.charge_amount || 0)) }),
                  ]} />
                )}
                {!isStorage && (householdPeople.length + visitorPeople.length + vehicles.length) > 0 && (
                  <Tile go="household" h={t("Household")} lines={[
                    [householdPeople.length && tp(householdPeople.length, "{n} occupant", "{n} occupants"), visitorPeople.length && tp(visitorPeople.length, "{n} visitor", "{n} visitors"), vehicles.length && tp(vehicles.length, "{n} vehicle", "{n} vehicles")].filter(Boolean).join(" · "),
                    bgTodo.length ? tp(bgTodo.length, "{n} background check needed", "{n} background checks needed") : householdPeople.slice(0, 3).map((p: any) => p.full_name).join(", "),
                  ]} />
                )}
                {!isStorage && (openMaintenance.length > 0 || propaneOrders.length > 0) && (
                  <Tile go="requests" h={t("Requests")} lines={[
                    openMaintenance.length ? tp(openMaintenance.length, "{n} open maintenance request", "{n} open maintenance requests") : tp(propaneReady.length, "{n} propane order ready", "{n} propane orders ready"),
                    openMaintenance[0] && `${openMaintenance[0].subject || t("Request")} — ${st(openMaintenance[0].status)}`,
                    openMaintenance.length > 0 && propaneReady.length > 0 && tp(propaneReady.length, "{n} propane order ready for pickup", "{n} propane orders ready for pickup"),
                  ]} />
                )}
                <Tile go="messages" h={t("Messages")} cta={notifications.length || announcements.length ? t("Open") : t("View")} lines={[
                  unreadNotifs.length ? tp(unreadNotifs.length, "{n} new notification", "{n} new notifications") : announcements[0] ? announcements[0].title : notifications[0] ? t("Notifications") : t("No messages yet"),
                  unreadNotifs.length ? err(unreadNotifs[0].message) : announcements[0] ? announcements[0].message : err(notifications[0]?.message),
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
                    <h2 style={{ fontWeight: 900, fontSize: 18, margin: 0 }}>{t("Autopay")}</h2>
                    <div style={{ fontSize: 12.5, color: "var(--gray)" }}>{t("Pay your monthly balance automatically")}</div>
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
                <p style={label}>{isStorage ? t("Monthly storage") : t("Rent Amount")}</p>
                <p style={bigNumber}>{money(isStorage ? Number(resident.storage_monthly || 0) : resident.rent_amount)}</p>
              </div>
            )}
            <div className="balance-card" style={{ ...cardAccent, order: -1, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "16px 20px" }}>
              <div>
                <p style={{ ...label, marginBottom: 2 }}>{t("Outstanding Balance")}</p>
                <p style={{ fontSize: 28, fontWeight: 900, margin: 0, lineHeight: 1.1, color: outstandingBalance > 0 ? "#b91c1c" : "#111827" }}>{money(outstandingBalance)}</p>
                <p style={{ fontSize: 12.5, color: "var(--gray)", margin: "4px 0 0" }}>{outstandingBalance > 0 ? t("Due on your account now") : t("Nothing due right now")}</p>
              </div>
              {acceptOnlinePayments && outstandingBalance > 0 && (
              <button
                onClick={handlePayNow}
                style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "12px 26px", fontWeight: 800, fontSize: 15, cursor: "pointer" }}
              >
                {t("Pay Now")}
              </button>
              )}
            </div>
          </div>
              </div>
              <div id="charges" className="rp-anchor">
          {processingInvoices.length > 0 && (
            <div style={{ ...card, background: "#eff6ff", border: "1.5px solid #93c5fd" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("🏦 Bank payment processing")}</h2>
              <p style={{ color: "#1e3a8a", fontSize: 13, marginBottom: 10 }}>
                {t("Your bank payment was received and takes 3–5 business days to clear. There is nothing to pay on these invoices meanwhile.")}
              </p>
              {processingInvoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, padding: "6px 0", borderTop: "1px solid #bfdbfe" }}>
                  <span>{t("Invoice — {month}", { month: dateLabel(inv.invoice_month) })} <span style={{ background: "#dbeafe", color: "#1e40af", borderRadius: 999, padding: "2px 8px", fontSize: 12, fontWeight: 700, marginLeft: 4 }}>{t("Processing (bank)")}</span></span>
                  <span style={{ fontWeight: 700 }}>{money(Number(inv.total_amount || 0))}</span>
                </div>
              ))}
            </div>
          )}
          {upcomingInvoices.length > 0 && (
            <div style={{ ...card, background: "#f9fafb" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("Upcoming")}</h2>
              {upcomingInvoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span>{t("Invoice — {month}", { month: dateLabel(inv.invoice_month) })} <span style={{ color: "var(--gray)", fontSize: 13 }}>· {inv.preparing_reason === "electric" ? err(inv.preparing_message) : inv.preparing_until ? t("Being prepared — available {date}", { date: dateLabel(inv.preparing_until) }) : t("available to pay on {date}", { date: dateLabel(invoicePayableFrom(inv.invoice_month, undefined, invoiceGenDay)) })}</span></span>
                  <span style={{ fontWeight: 700 }}>{money(Number(inv.total_amount || 0))}</span>
                </div>
              ))}
            </div>
          )}
          {payAheadInvoices.length > 0 && (
            <div style={{ ...card, background: "#f0fdf4", border: "1.5px solid #bbf7d0" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("Pay ahead (optional)")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 10 }}>
                {autopayEnabled
                  ? t("Next month's invoice is ready. You can pay it now if you like, or any time until its due date — autopay pays it on the due date.")
                  : t("Next month's invoice is ready. You can pay it now if you like, or any time until its due date.")}
              </p>
              {payAheadInvoices.map((inv) => {
                const items = invoiceItemsByInvoice[inv.id] || [];
                return (
                  <div key={inv.id} style={{ borderTop: "1px solid #bbf7d0", padding: "8px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14, fontWeight: 700 }}>
                      <span>{inv.due_date ? t("Invoice — {month} · due {date}", { month: dateLabel(inv.invoice_month), date: date(String(inv.due_date).slice(0, 10)) }) : t("Invoice — {month}", { month: dateLabel(inv.invoice_month) })}</span>
                      <span>{money(Number(inv.total_amount || 0))}</span>
                    </div>
                    {items.map((item: any) => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--gray)" }}>
                        <span>{t(item.description || item.charge_type || "Charge")}</span>
                        <span>{money(item.amount)}</span>
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
                  {t("Pay ahead {amount}", { amount: money(payAheadTotal) })}
                </button>
              )}
            </div>
          )}
          {pendingInvoices.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("Outstanding Charges")}</h2>
              {nextPaymentDate && (
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                  {t("Next Payment (Due Date):")} <strong>{dateLabel(nextPaymentDate)}</strong>
                  {graceNote}
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {pendingInvoices.map(inv => {
                  const items = invoiceItemsByInvoice[inv.id] || [];
                  return (
                    <div key={inv.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12 }}>
                      <p style={{ fontWeight: 700, marginBottom: 8 }}>{t("Invoice — {month}", { month: dateLabel(inv.invoice_month) })}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {items.length > 0 ? (
                          items.map(item => (
                            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                              <span style={{ color: "var(--gray)" }}>{t(item.description || item.charge_type || "Charge")}</span>
                              <span style={{ fontWeight: 700 }}>{money(item.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Rent + any recurring charges")}</p>
                        )}
                      </div>
                      <div style={{ borderTop: "1.5px solid var(--border)", marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700 }}>{t("Invoice Total")}</span>
                        <span style={{ fontWeight: 900 }}>{money(inv.total_amount)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ borderTop: "1.5px solid var(--border)", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 900 }}>{t("Total Due")}</span>
                <span style={{ fontWeight: 900 }}>{money(outstandingBalance)}</span>
              </div>
              {acceptOnlinePayments && (
              <button
                onClick={handlePayNow}
                style={{ marginTop: 16, width: "100%", background: "#d3f8e2", border: "2px solid #16a34a", borderRadius: 6, padding: 14, fontWeight: 700, cursor: "pointer" }}
              >
                {t("Pay Online")}
              </button>
              )}
            </div>
          )}
              </div>
              <div className="rp-links">
            <button onClick={() => router.push(subPageHref("/residents/invoices", "pay"))} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("🧾 Invoices")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("View your monthly invoices and charges.")}</p>
            </button>
            <button onClick={() => router.push(subPageHref("/residents/payment-history", "pay"))} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("📜 Payment History")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("View completed payments.")}</p>
            </button>
              </div>
              {!isStorage && (<>
              <div id="electric" className="rp-anchor">
          <div style={card}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("⚡ Electric Usage")}</h2>
            {electricUsage.length === 0 ? (
              <p style={{ color: "var(--gray)" }}>{t("No electric usage available yet.")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div><p style={label}>{t("Billing Month")}</p><p style={bigNumber}>{electricUsage[0]?.billing_month ? dateLabel(electricUsage[0].billing_month) : t("N/A")}</p></div>
                {/* Oct 20: parks that don't use meter numbers (the lot identifies the meter) don't show this */}
                {electricUsage[0]?.meter_number && (
                  <div><p style={label}>{t("Meter Number")}</p><p style={bigNumber}>{electricUsage[0].meter_number}</p></div>
                )}
                <div><p style={label}>{t("This Month's Usage")}</p><p style={bigNumber}>{electricUsage[0]?.current_reading || 0} kWh</p></div>
                <div><p style={label}>{t("Last Month's Usage")}</p><p style={bigNumber}>{electricUsage[0]?.previous_reading || 0} kWh</p></div>
                <div><p style={label}>{t("Days of Service")}</p><p style={bigNumber}>{electricUsage[0]?.days_of_service ?? t("N/A")}</p></div>
                <div><p style={label}>{t("Included kWh")}</p><p style={bigNumber}>{electricUsage[0]?.included_kwh || 0} kWh</p></div>
                <div><p style={label}>{t("Billable kWh")}</p><p style={bigNumber}>{electricUsage[0]?.billable_kwh || 0} kWh</p></div>
                <div><p style={label}>{t("Rate per kWh")}</p><p style={bigNumber}>{money(electricUsage[0]?.rate_per_kwh)}</p></div>
                <div style={{ gridColumn: "span 2", borderTop: "1.5px solid var(--border)", paddingTop: 16 }}>
                  <p style={label}>{t("Electric Charge")}</p>
                  <p style={{ fontSize: 30, fontWeight: 900, color: "#b91c1c" }}>{money(electricUsage[0]?.charge_amount)}</p>
                </div>
              </div>
            )}
          </div>
              </div>
          {electricUsage.length > 0 && (
            <button className="rp-linkcard" onClick={() => router.push(subPageHref("/electric-history", "pay"))} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("📊 Electric Usage History")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("View monthly electric readings, charges, and usage history.")}</p>
            </button>
          )}
              </>)}
            </>)}

            {section === "lot" && (<>
              <div id="rent-to-own" className="rp-anchor">
          {rentToOwnPlan && rentToOwnPlan.status === "pending_signatures" && (
            <div style={{ ...card, marginTop: 16, background: "#fffbeb", border: "2px solid #f59e0b" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
                {t("🎉 Your Rent-to-Own home is fully paid off!")}
              </h2>
              <p style={{ ...label, marginBottom: 12 }}>
                {t("To finalize your Bill of Sale, both you and the park need to digitally sign. Type your full legal name below to sign your side.")}
              </p>
              {rentToOwnPlan.resident_signed_at ? (
                <p style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>
                  {t("✓ You signed on {date}.", { date: date(rentToOwnPlan.resident_signed_at, { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }) })}{" "}
                  {rentToOwnPlan.admin_signed_at
                    ? t("Waiting on the final document to generate — refresh in a moment.")
                    : t("Waiting on the park's signature to finalize your Bill of Sale.")}
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={billOfSaleSignatureInput}
                    onChange={(e) => setBillOfSaleSignatureInput(e.target.value)}
                    placeholder={t("Type your full legal name to sign")}
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
                        setBillOfSaleMessage(err(result.error) || t("Something went wrong. Please try again."));
                        return;
                      }
                      setBillOfSaleMessage(
                        result.completed
                          ? t("Signed! Your Bill of Sale is finalized — find it under Documents.")
                          : t("Signed! Waiting on the park's signature to finalize your Bill of Sale.")
                      );
                      fetch(`/api/portal/rent-to-own-plan?residentId=${residentId}`)
                        .then((r) => r.json())
                        .then((d) => d.plan && setRentToOwnPlan(d.plan))
                        .catch(() => {});
                    }}
                    style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}
                  >
                    {signingBillOfSale ? t("Signing...") : t("Sign Bill of Sale")}
                  </button>
                </>
              )}
              {billOfSaleMessage && <p style={{ ...label, marginTop: 10 }}>{billOfSaleMessage}</p>}
            </div>
          )}
          {rentToOwnPlan && rentToOwnPlan.status !== "pending_signatures" && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>
                {t("🏡 Rent-to-Own Plan")} {rentToOwnPlan.lot_name ? `— ${t("Lot {name}", { name: rentToOwnPlan.lot_name })}` : ""}
              </h2>
              <p style={{ ...label, marginBottom: 12 }}>
                {t("{amount}/month toward your total purchase price", { amount: money(rentToOwnPlan.monthly_principal) })}
              </p>
              <div style={{ fontSize: 14, marginBottom: 6 }}>
                {t("{paid} paid of {total}", { paid: money(rentToOwnPlan.paid_so_far), total: money(rentToOwnPlan.total_price) })}
                {" — "}
                <strong>{t("{amount} remaining", { amount: money(rentToOwnPlan.remaining) })}</strong>
              </div>
              <div style={{ ...label, marginBottom: 6 }}>
                {(() => { const left = Math.max(0, Math.ceil(rentToOwnPlan.remaining / rentToOwnPlan.monthly_principal)); return tp(left, "{n} payment left", "{n} payments left"); })()}
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
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("🏠 Home/Unit Info")}</h2>
              {!editingRvInfo && (
                <button
                  onClick={() => { setEditingRvInfo(true); setRvMessage(""); }}
                  style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  {t("Edit")}
                </button>
              )}
            </div>

            {editingRvInfo ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, marginBottom: 12 }}>
                  <select value={rvType} onChange={e => setRvType(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }}>
                    <option value="RV">{t("RV")}</option>
                    <option value="Park Model">{t("Park Model")}</option>
                    <option value="Mobile Home">{t("Mobile Home")}</option>
                    <option value="Other">{t("Other")}</option>
                  </select>
                  <input placeholder={t("Make")} value={rvMake} onChange={e => setRvMake(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Model")} value={rvModel} onChange={e => setRvModel(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Year")} value={rvYear} onChange={e => setRvYear(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Length (ft)")} type="number" value={rvLengthFt} onChange={e => setRvLengthFt(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Width (ft) — optional")} type="number" value={rvWidthFt} onChange={e => setRvWidthFt(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("VIN / Tag #")} value={rvVinOrTag} onChange={e => setRvVinOrTag(e.target.value)} style={{ width: "100%", minWidth: 0, boxSizing: "border-box", border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, gridColumn: "span 2" }} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={saveRvInfo}
                    disabled={savingRvInfo}
                    style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: savingRvInfo ? "default" : "pointer", opacity: savingRvInfo ? 0.7 : 1 }}
                  >
                    {savingRvInfo ? t("Saving...") : t("Save")}
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
                      {t("Cancel")}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12 }}>
                <p style={{ fontWeight: 700 }}>{t(rvType || "RV")} — {rvYear} {rvMake} {rvModel}</p>
                <p style={{ fontSize: 13 }}>{rvLengthFt ? t("{n} ft", { n: rvLengthFt }) : t("Length not set")}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("VIN / Tag #: {value}", { value: rvVinOrTag || "—" })}</p>
              </div>
            )}
            {rvMessage && <p style={{ fontSize: 13, marginTop: 8, color: rvMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{rvMessage}</p>}
          </div>
              </div>
              <div id="parking-pets" className="rp-anchor">
          {!editingPets ? (
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("🅿️ Parking & Pets")}</h2>
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
                  {t("Edit Pets")}
                </button>
              </div>

              <p><strong>{t("Parking:")}</strong>{" "}
                {resident?.parking_provided
                  ? `${t("{n} space(s)", { n: resident?.parking_spaces || t("Designated") })}${
                      resident?.parking_free ? "" : `, ${money(resident?.parking_cost)}`
                    }`
                  : t("Not provided")}
              </p>
              <p style={{ marginTop: 8 }}><strong>{t("Pets:")}</strong>{" "}
                {resident?.pets_allowed
                  ? `${t("{n} pet(s)", { n: resident?.pets_count || 0 })}${resident?.pets_types ? ` (${resident.pets_types})` : ""}`
                  : t("Not permitted")}
              </p>
              {resident?.pets_allowed && Array.isArray(resident?.pet_details) && resident.pet_details.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {resident.pet_details.map((p: PortalPet, i: number) => (
                    <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
                      <strong>{p.name || t("Pet {n}", { n: i + 1 })}</strong>
                      {` — ${[p.type, p.breed, p.color, p.weight ? t("{n} lbs", { n: p.weight }) : ""].filter(Boolean).join(", ")}`}
                      <span style={{ color: p.shots_provided === "yes" ? "#16a34a" : "#b45309", marginLeft: 6 }}>
                        {p.shots_provided === "yes" ? t("Shots records provided") : t("Shots records not provided")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ marginTop: 8 }}><strong>{t("Parking Sticker ID#(s):")}</strong>{" "}
                {vehicles.length === 0
                  ? t("No vehicles on file")
                  : vehicles.map((v) => v.parking_sticker_id || t("Not yet assigned")).join(", ")}
              </p>
              <p style={{ marginTop: 8 }}><strong>{t("Gate Access Clickers Issued:")}</strong> {resident?.gate_clickers_count ?? 0}</p>
              <p style={{ marginTop: 8 }}><strong>{t("Mailbox Keys Issued:")}</strong> {resident?.mailbox_keys_count ?? 0}</p>
              <p style={{ marginTop: 8 }}><strong>{t("Mailbox #:")}</strong> {resident?.mailbox_number || t("Not yet assigned")}</p>

              <p style={{ color: "var(--gray)", fontSize: 12, marginTop: 12 }}>
                {t("Lost or damaged items may be subject to a replacement fee — contact the office for details.")}
              </p>
            </div>
          ) : (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("Edit Pets")}</h2>
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
                <span>{t("I have pet(s)")}</span>
              </div>
              {petsAllowedInput && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("How many pets?")}</label>
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
                        <strong style={{ fontSize: 13 }}>{t("Pet {n}", { n: i + 1 })}</strong>
                        <div><label style={lbl}>{t("Type")}</label><input style={inputStyle} placeholder={t("e.g. Dog, Cat")} value={pet.type} onChange={(e) => update({ type: e.target.value })} /></div>
                        <div><label style={lbl}>{t("Name of your pet")}</label><input style={inputStyle} value={pet.name} onChange={(e) => update({ name: e.target.value })} /></div>
                        <div><label style={lbl}>{t("Breed")}</label><input style={inputStyle} value={pet.breed} onChange={(e) => update({ breed: e.target.value })} /></div>
                        <div><label style={lbl}>{t("Color")}</label><input style={inputStyle} value={pet.color} onChange={(e) => update({ color: e.target.value })} /></div>
                        <div><label style={lbl}>{t("Weight (lbs)")}</label><input style={inputStyle} inputMode="numeric" value={pet.weight} onChange={(e) => update({ weight: e.target.value })} /></div>
                        <div>
                          <label style={lbl}>{t("Provided shots records?")}</label>
                          <select style={{ ...inputStyle, background: "#fff" }} value={pet.shots_provided} onChange={(e) => update({ shots_provided: e.target.value as PortalPet["shots_provided"] })}>
                            <option value="">{t("Select...")}</option>
                            <option value="yes">{t("Yes")}</option>
                            <option value="no">{t("No")}</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>{t("The park office is notified whenever you update this information.")}</p>
              <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={savePets} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Save")}</button>
                <button onClick={() => { setEditingPets(false); setPetsMessage(""); }} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Cancel")}</button>
                {petsMessage && <p style={{ fontSize: 13, color: petsMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{petsMessage}</p>}
              </div>
            </div>
          )}
              </div>
              <div className="rp-links">
            <button id="documents" className="rp-anchor" onClick={() => router.push(subPageHref("/residents/documents", "lot"))} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("📄 Documents")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("View and print your signed site rental agreement and any signed resident agreements.")}</p>
            </button>
            {activeLease && (
              <button
                onClick={() => setShowMoveOutModal(true)}
                style={{ ...card, textAlign: "left", cursor: "pointer" }}
              >
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("🚪 Moving Out?")}</h2>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Let us know your planned move-out date.")}</p>
              </button>
            )}
              </div>
              {activeLease?.requested_move_out_date && (
                <p style={{ fontSize: 13, color: "var(--gray)", margin: 0 }}>
                  {t("Requested move-out date:")} <strong>{date(activeLease.requested_move_out_date)}</strong> <span style={{ color: "#16a34a", fontWeight: 700 }}>{t("Submitted ✓")}</span>
                </p>
              )}
            </>)}

            {section === "household" && (<>
          {pendingBgChecks.length > 0 && (
            <div style={{ ...card, border: "2px solid #fb923c", background: "#fff7ed" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6, color: "#9a3412" }}>{t("⚠️ Background Check Needed")}</h2>
              <p style={{ fontSize: 13, color: "#9a3412", marginBottom: 12 }}>
                {pendingBgChecks.length === 1
                  ? t("1 household occupant still needs a background check paid for and started.")
                  : t("{n} household occupants still need a background check paid for and started.", { n: pendingBgChecks.length })}
              </p>
              <button
                onClick={() => router.push(subPageHref("/residents/background-checks", "household"))}
                style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {t("Continue to Background Check(s)")}
              </button>
            </div>
          )}
          <div id="household-occupants" style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("Household Occupants")}</h2>
              <button onClick={() => { setOccType("household"); setEditingVisitorId(null); setOccFullName(""); setOccRelationship(""); setOccPhone(""); setOccEmail(""); setOccDateOfBirth(""); setAddingOccupant(!addingOccupant || occType !== "household"); }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingOccupant && occType === "household" ? t("Cancel") : t("+ Add")}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--gray)", marginBottom: 12 }}>{t("People living here permanently. Anyone 18 or older requires a background check.")}</p>

            {addingOccupant && occType === "household" && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder={t("Full Name")} value={occFullName} onChange={e => setOccFullName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Relationship")} value={occRelationship} onChange={e => setOccRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Phone")} value={occPhone} onChange={e => setOccPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Email")} value={occEmail} onChange={e => setOccEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <div style={{ gridColumn: "span 2" }}>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Date of Birth (required)")}</label>
                    <input type="date" value={occDateOfBirth} onChange={e => setOccDateOfBirth(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  {(() => {
                    const a = calculateAge(occDateOfBirth);
                    if (a === null || a < 18) return null;
                    return (
                      <div style={{ gridColumn: "span 2" }}>
                        <label style={{ fontSize: 12, color: "var(--gray)" }}>
                          {t(editingVisitorId ? "Social Security # (leave blank to keep the one on file)" : "Social Security # (required for adults 18+)")}
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
                          {t("Email is also required for adults. Stored securely; the office only sees the last 4 digits.")}
                        </p>
                      </div>
                    );
                  })()}
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {editingVisitorId ? t("Update Occupant") : t("Save")}
                </button>
                {occupantMessage && occType === "household" && <p style={{ fontSize: 13, marginTop: 8, color: occupantMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{occupantMessage}</p>}
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
                      {t("Date of Birth: {date}", { date: (() => {
                        const m = String(person.date_of_birth).match(/^(\d{4})-(\d{2})-(\d{2})/);
                        // English keeps mm/dd/yyyy (as entered); Spanish/Portuguese read dd/mm/yyyy.
                        return m ? (lang === "en" ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`) : String(person.date_of_birth);
                      })() })}
                      {age !== null ? t(" · Age: {n}", { n: age }) : ""}
                    </p>
                  )}
                  {!person.date_of_birth && age !== null && <p style={{ color: "var(--gray)", fontSize: 12 }}>{t("Age: {n}", { n: age })}</p>}
                  <div style={{ display: "flex", gap: 12, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={() => startEditVisitor(person)} style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("Edit")}</button>
                    <button onClick={() => deleteVisitor(person.id)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("Remove")}</button>
                  </div>
                  {needsBackgroundCheck && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: bgDone ? "#f0fdf4" : "#fff7ed", border: bgDone ? "1px solid #bbf7d0" : "1px solid #fed7aa" }}>
                      {bgDone ? (
                        <p style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>
                          {t("Background check: {status}", { status: t(bgStatus === "Passed" ? "Passed" : bgStatus === "Needs Review" ? "Needs Review" : "In progress") })}
                        </p>
                      ) : !person.has_id_uploaded ? (
                        // Aug 4 (per Mely): step 1 only — don't show
                        // "Proceed with Background Check" until the ID is
                        // actually uploaded, so the resident isn't
                        // confused into thinking they can skip ahead.
                        <>
                          <p style={{ fontSize: 12, color: "#9a3412", fontWeight: 700, marginBottom: 6 }}>
                            {t("This person is 18 or older — a background check is required before move-in is compliant.")}
                          </p>
                          <p style={{ fontSize: 12, color: "#9a3412", marginBottom: 8 }}>
                            {t("Please upload a photo ID in Documents, then proceed with the background check.")}
                          </p>
                          <button onClick={() => router.push(subPageHref(`/residents/documents?forOccupant=${person.id}`, "household"))} style={{ background: "#fff", border: "1.5px solid #9a3412", color: "#9a3412", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {t("Upload ID")}
                          </button>
                        </>
                      ) : (
                        // Step 2 — ID is on file, now they can proceed.
                        <>
                          <p style={{ fontSize: 12, color: "#9a3412", fontWeight: 700, marginBottom: 8 }}>
                            {t("ID received. Now proceed with the background check.")}
                          </p>
                          <button onClick={() => router.push(subPageHref("/residents/background-checks", "household"))} style={{ background: "#9a3412", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                            {t("Proceed with Background Check")}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {occupants.filter(p => p.occupant_type !== "visitor").length === 0 && <p style={{ color: "var(--gray)" }}>{t("No household occupants listed.")}</p>}
          </div>
          <div id="visitors-section" style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("Visitors")}</h2>
              <button onClick={() => { setOccType("visitor"); setEditingVisitorId(null); setOccFullName(""); setOccRelationship(""); setOccPhone(""); setOccEmail(""); setOccStayStart(""); setOccStayEnd(""); setAddingOccupant(!addingOccupant || occType !== "visitor"); }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingOccupant && occType === "visitor" ? t("Cancel") : t("+ Add")}
              </button>
            </div>
            <p style={{ fontSize: 11, color: "var(--gray)", marginBottom: 12 }}>{t("Temporary guests. You can add, edit, or remove these anytime.")}</p>

            {addingOccupant && occType === "visitor" && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder={t("Full Name")} value={occFullName} onChange={e => setOccFullName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Relationship")} value={occRelationship} onChange={e => setOccRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Phone")} value={occPhone} onChange={e => setOccPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Email")} value={occEmail} onChange={e => setOccEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Stay Start Date (required)")}</label>
                    <input type="date" value={occStayStart} onChange={e => setOccStayStart(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Stay End Date (required)")}</label>
                    <input type="date" value={occStayEnd} onChange={e => setOccStayEnd(e.target.value)} required style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <button onClick={addOccupant} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {editingVisitorId ? t("Update Visitor") : t("Save Visitor")}
                </button>
                {occupantMessage && occType === "visitor" && <p style={{ fontSize: 13, marginTop: 8, color: occupantMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{occupantMessage}</p>}
              </div>
            )}

            {occupants.filter(p => p.occupant_type === "visitor").map(person => (
              <div key={person.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{person.full_name}</p>
                <p style={{ fontSize: 13 }}>{person.relationship}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{person.phone} {person.email}</p>
                {(person.stay_start_date || person.stay_end_date) && (
                  <p style={{ color: "var(--gray)", fontSize: 12 }}>
                    {t("Stay: {start} to {end}", { start: person.stay_start_date ? date(person.stay_start_date) : "?", end: person.stay_end_date ? date(person.stay_end_date) : "?" })}
                  </p>
                )}
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <button onClick={() => startEditVisitor(person)} style={{ background: "none", border: "none", color: "var(--gray)", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("Edit")}</button>
                  <button onClick={() => deleteVisitor(person.id)} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}>{t("Remove")}</button>
                </div>
              </div>
            ))}
            {occupants.filter(p => p.occupant_type === "visitor").length === 0 && <p style={{ color: "var(--gray)" }}>{t("No visitors listed.")}</p>}
          </div>
              <div id="vehicles" className="rp-anchor">
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("Vehicles")}</h2>
              <button onClick={() => {
                setEditingVehicleId(null);
                setVehMake(""); setVehModel(""); setVehYear(""); setVehColor(""); setVehPlate(""); setVehState("");
                setAddingVehicle(!addingVehicle);
              }} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {addingVehicle ? t("Cancel") : t("+ Add")}
              </button>
            </div>

            {addingVehicle && (
              <div style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 16, marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <input placeholder={t("Make")} value={vehMake} onChange={e => setVehMake(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Model")} value={vehModel} onChange={e => setVehModel(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Year")} value={vehYear} onChange={e => setVehYear(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("Color")} value={vehColor} onChange={e => setVehColor(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("License Plate")} value={vehPlate} onChange={e => setVehPlate(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                  <input placeholder={t("License State")} value={vehState} onChange={e => setVehState(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10 }} />
                </div>
                <button onClick={addVehicle} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{editingVehicleId ? t("Update Vehicle") : t("Save Vehicle")}</button>
                {vehicleMessage && <p style={{ fontSize: 13, marginTop: 8, color: vehicleMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{vehicleMessage}</p>}
              </div>
            )}

            {vehicles.map(v => (
              <div key={v.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <p style={{ fontWeight: 700 }}>{v.vehicle_year} {v.vehicle_make} {v.vehicle_model}</p>
                <p style={{ fontSize: 13 }}>{v.color}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Plate: {value}", { value: `${v.license_plate || ""} ${v.license_state || ""}`.trim() })}</p>
                <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Parking Sticker ID#: {value}", { value: v.parking_sticker_id || t("Not yet assigned") })}</p>
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
                    {t("Edit")}
                  </button>
                  <button
                    onClick={() => deleteVehicle(v.id)}
                    style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, textDecoration: "underline", cursor: "pointer", padding: 0 }}
                  >
                    {t("Remove")}
                  </button>
                </div>
              </div>
            ))}
            {vehicles.length === 0 && <p style={{ color: "var(--gray)" }}>{t("No vehicles listed.")}</p>}
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
          <div className="rp-linkcard" onClick={() => router.push(subPageHref("/residents/maintenance", "requests"))} style={{ ...card, cursor: "pointer" }}>
            <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("Maintenance Requests")}</h2>
            <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Report issues and track maintenance progress.")}</p>
          </div>
          )}
          {!requestsVisible && (
            <div style={card}><p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Maintenance requests are handled by the office — please call or message us.")}</p></div>
          )}
              </div>
              {openMaintenance.length > 0 && (
                <div style={card}>
                  <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("Open Requests")}</h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {openMaintenance.slice(0, 5).map((r: any) => (
                      <button key={r.id} type="button" className="rp-attn-row" onClick={() => router.push(subPageHref("/residents/maintenance", "requests"))}>
                        <span className="rp-attn-text"><b>{r.subject || t("Maintenance request")}</b><small>{st(r.status)}{r.priority ? t(" · {p} priority", { p: st(r.priority) }) : ""}</small></span>
                        <span className="rp-attn-go">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div id="propane" className="rp-anchor">
          {propaneOrders.length > 0 && (
            <div style={{ ...card, marginTop: 16 }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("⛽ Propane Orders")}</h2>
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
                        alt={t("Propane pickup QR code")}
                        style={{ width: 100, height: 100, flexShrink: 0 }}
                      />
                    ) : null}
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 700, margin: 0 }}>
                        {order.unit === "gallon" ? t("{n} gallons", { n: order.quantity }) : `${order.quantity} ×`} {order.product_label}
                      </p>
                      <p style={{ color: "var(--gray)", fontSize: 13, margin: "2px 0" }}>
                        {t("{amount} — paid {date}", { amount: money(order.amount_total), date: date(order.paid_at, { month: "short", day: "numeric", year: "numeric" }) })}
                      </p>
                      <p style={{ fontSize: 12.5, margin: "4px 0", color: order.redeemed ? "#16a34a" : "#b45309", fontWeight: 700 }}>
                        {(() => {
                          const maxRedemptions = order.unit === "tank" ? Math.max(1, Math.floor(order.quantity)) : 1;
                          const count = order.redeemed_count || 0;
                          if (order.redeemed) return t("✅ Fully picked up");
                          if (count > 0) return t("🕓 Picked up {count}/{max} — show this code to staff for the rest", { count, max: maxRedemptions });
                          return t("🕓 Ready for pickup — show this code to staff");
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
                        {t("Remove from my portal")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
              </div>
              {residentId && <RecHallCard residentId={residentId} onAvailability={setRecHallOn} />}
            </>)}

            {section === "messages" && (<>
              <div id="notifications" className="rp-anchor" style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("🔔 Notifications")}</h2>
                {notifications.length === 0 ? (
                  <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Nothing yet.")}</p>
                ) : (
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                    {notifications.map((n) => notifRow(n, !n.resident_read_at || freshNotifIds.has(String(n.id))))}
                  </div>
                )}
              </div>
              <div id="announcements" className="rp-anchor">
          {announcements.length > 0 && (
            <div style={card}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("Announcements")}</h2>
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
                <div style={card}><p style={{ color: "var(--gray)", fontSize: 13 }}>{t("No announcements from the park right now.")}</p></div>
              )}
            </>)}

            {section === "info" && <ParkInfoSection data={parkInfo} />}

            {section === "more" && (<>
              <InstallApp appName={resident?.companies?.company_name || "resident"} accent="#0f5132" portal />
              <div className="rp-more-list">
                {(isStorage ? (["info"] as SectionId[]) : (["household", "requests", "info"] as SectionId[])).filter((id) => id !== "requests" || requestsVisible).map((id) => {
                  const x = SECTIONS.find((s) => s.id === id)!;
                  return <button key={id} type="button" onClick={() => openSection(id)}><NavIcon d={x.icon} /><span>{t(x.label)}</span><Badge n={badge[id]} /><span className="rp-attn-go">→</span></button>;
                })}
              </div>
              {isStorage && (
                <div id="storage-info" className="rp-anchor" style={card}>
                  <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("My storage")}</h2>
                  <p><strong>{t("Storage space:")}</strong> {storageSpacesText || t("None")}</p>
                  {resident.storage_unit && <p style={{ marginTop: 8 }}><strong>{t("Stored:")}</strong> {t(resident.storage_unit)}{resident.rv_vin_or_tag ? ` · ${resident.rv_vin_or_tag}` : ""}</p>}
                  <p style={{ marginTop: 8 }}><strong>{t("Monthly storage")}:</strong> {resident.storage_active === false ? t("Storage ended") : money(Number(resident.storage_monthly || 0))}</p>
                  <p style={{ fontSize: 12, color: "var(--gray)", marginTop: 10 }}>{t("To change or end your storage, please contact the office.")}</p>
                </div>
              )}
              <div id="profile" className="rp-anchor">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            {!editingResidentInfo ? (
              <div id="resident-info" style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("Resident Information")}</h2>
                  <button onClick={openEditResidentInfo} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("Edit")}</button>
                </div>
                <p><strong>{t("Email:")}</strong> {resident.email || t("No email")}</p>
                <p style={{ marginTop: 8 }}><strong>{t("Phone:")}</strong> {resident.phone || t("No phone")}</p>
                <SmsAlertsToggle residentId={resident.id} parkName={resident?.companies?.company_name || ""} phone={resident.phone} />
              </div>
            ) : (
              <div id="resident-info" style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("Edit Resident Information")}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Email")}</label>
                    <input placeholder={t("Email")} value={formEmail} onChange={e => setFormEmail(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Phone")}</label>
                    <input placeholder={t("Phone")} value={formPhone} onChange={e => setFormPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>{t("The park office is notified whenever you update this information.")}</p>
                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={saveResidentInfo} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Save")}</button>
                  <button onClick={() => setEditingResidentInfo(false)} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Cancel")}</button>
                  {residentInfoMessage && <p style={{ fontSize: 13, color: residentInfoMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{residentInfoMessage}</p>}
                </div>
              </div>
            )}

            {!editingEmergencyContact ? (
              <div id="emergency-contact" style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h2 style={{ fontWeight: 900, fontSize: 18 }}>{t("Emergency Contact")}</h2>
                  <button onClick={openEditEmergencyContact} style={{ background: "transparent", border: "1.5px solid #000", borderRadius: 6, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t("Edit")}</button>
                </div>
                <p><strong>{t("Name:")}</strong> {resident.emergency_contact_name || t("None")}</p>
                <p><strong>{t("Phone:")}</strong> {resident.emergency_contact_phone || t("None")}</p>
                <p><strong>{t("Relationship:")}</strong> {resident.emergency_contact_relationship || t("None")}</p>
              </div>
            ) : (
              <div id="emergency-contact" style={card}>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>{t("Edit Emergency Contact")}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Name")}</label>
                    <input placeholder={t("Name")} value={formEmergencyName} onChange={e => setFormEmergencyName(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Phone")}</label>
                    <input placeholder={t("Phone")} value={formEmergencyPhone} onChange={e => setFormEmergencyPhone(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--gray)" }}>{t("Relationship")}</label>
                    <input placeholder={t("e.g. Mother, Spouse, Friend")} value={formEmergencyRelationship} onChange={e => setFormEmergencyRelationship(e.target.value)} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: 10, width: "100%" }} />
                  </div>
                </div>
                <p style={{ fontSize: 11, color: "var(--gray)", marginTop: 8 }}>{t("The park office is notified whenever you update this information.")}</p>
                <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={saveEmergencyContact} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Save")}</button>
                  <button onClick={() => setEditingEmergencyContact(false)} style={{ background: "transparent", border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>{t("Cancel")}</button>
                  {emergencyContactMessage && <p style={{ fontSize: 13, color: emergencyContactMessage.startsWith(BAD) ? "#dc2626" : "#16a34a" }}>{emergencyContactMessage}</p>}
                </div>
              </div>
            )}
          </div>
              </div>
              {!isStorage && (
              <div id="marketplace" className="rp-links">
            <button onClick={() => router.push(subPageHref("/residents/marketplace", "more"))} style={{ ...card, textAlign: "left", cursor: "pointer" }}>
              <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("🛍️ Marketplace")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13 }}>{t("Buy and sell with your neighbors.")}</p>
            </button>
              </div>
              )}
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={logout} style={{ background: "#000", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
                  {t("Sign Out")}
                </button>
                {/* Oct 29: language switch also in the menu (Profile & more) */}
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t("Language")}:</span>
                <PortalLangSwitcher residentId={residentId} compact />
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
                  aria-label={t("Close")}
                >
                  ✕
                </button>
                <h2 id="pay-choice-title" style={{ fontWeight: 900, fontSize: 18, marginBottom: 4 }}>{t("How would you like to pay?")}</h2>
                <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 14 }}>{payScope === "ahead" ? t("Paying ahead") : t("Balance")}: <strong>{money(payAmount)}</strong></p>
                {/* Oct 28 (per Mely): bank is listed first, recommended and preselected; the resident
                    picks one and continues. */}
                <div role="radiogroup" aria-label={t("Payment method")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {([
                    {
                      v: "ach" as const,
                      title: t("Pay by bank (ACH)"),
                      sub: `${achFee > 0 ? t("fee {amount}", { amount: money(achFee) }) : t("no fee")}${cardFee > achFee ? t(" — {amount} less than card", { amount: money(cardFee - achFee) }) : ""}${t(" · clears in 3–5 business days")}`,
                      badge: cardFee > achFee ? t("Recommended · lowest fee") : t("Recommended"),
                    },
                    { v: "card" as const, title: t("Pay by card"), sub: `${cardFee > 0 ? t("fee {amount}", { amount: money(cardFee) }) : t("no fee")}${t(" · paid instantly")}`, badge: "" },
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
                  {payMethodChoice === "ach" ? t("Continue to pay by bank") : t("Continue to pay by card")}
                </button>
                {startingPayment && <p style={{ fontSize: 13, marginTop: 8, color: "var(--gray)" }}>{t("Opening secure payment…")}</p>}
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
                  aria-label={t("Close")}
                >
                  ✕
                </button>
                <h2 style={{ fontWeight: 900, fontSize: 18, marginBottom: 6 }}>{t("🚪 Moving Out?")}</h2>
              <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 8 }}>
                {t("Please give us at least {n} days notice.", { n: moveOutThresholdDays })}
              </p>
              <p style={{ color: "#b45309", fontSize: 13, marginBottom: 12, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                {t("Before moving out, your outstanding balance must be $0.")}
              </p>
              {activeLease.requested_move_out_date ? (
                <>
                  <p style={{ fontSize: 14, marginBottom: 12, color: "var(--black)" }}>
                    {t("Requested move-out date:")} <strong>{date(activeLease.requested_move_out_date)}</strong>
                    {" "}<span style={{ color: "#16a34a", fontWeight: 700 }}>{t("Submitted ✓")}</span>
                  </p>
                  <p style={{ color: "#b45309", fontSize: 13, marginBottom: 12, background: "#fffbeb", padding: 8, borderRadius: 6 }}>
                    {t("Please check your email — the office will confirm your move-out date there once approved.")}
                  </p>
                  <p style={{ color: "var(--gray)", fontSize: 13, marginBottom: 12 }}>
                    {t("Changed your mind, or need a different date? Cancel below, then submit a new one.")}
                  </p>
                  <button
                    onClick={handleCancelMoveOut}
                    disabled={moveOutSubmitting}
                    style={{ background: "#fff", color: "#dc2626", border: "1.5px solid #dc2626", borderRadius: 6, padding: "10px 16px", fontWeight: 700, cursor: "pointer", opacity: moveOutSubmitting ? 0.6 : 1 }}
                  >
                    {moveOutSubmitting ? t("Cancelling...") : t("Cancel Request")}
                  </button>
                </>
              ) : (
                <>
                  <label style={label}>{t("Move-Out Date")}</label>
                  <input
                    type="date"
                    value={moveOutDate}
                    onChange={(e) => setMoveOutDate(e.target.value)}
                    style={{ width: "100%", padding: 10, border: "1.5px solid var(--border)", borderRadius: 6, marginBottom: 10 }}
                  />
                  <label style={label}>{t("Notes (optional)")}</label>
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
                    {moveOutSubmitting ? t("Sending...") : t("Submit Move-Out Date")}
                  </button>
                </>
              )}
              {moveOutMessage && (
                <p style={{ fontSize: 13, marginTop: 8, color: moveOutMessage === SUBMITTED ? "#16a34a" : "var(--black)", fontWeight: moveOutMessage === SUBMITTED ? 700 : 400 }}>
                  {moveOutMessage === SUBMITTED ? t(SUBMITTED) : moveOutMessage}
                </p>
              )}
              </div>
            </div>
          )}
          </div>
        </div>

        <ResidentTabBar section={section} badge={badge} moreBadge={moreTabBadge} onSection={openSection} storage={isStorage} />
      </section>
    </>
  );
}
