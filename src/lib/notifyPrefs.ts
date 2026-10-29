// Oct 29 (per Mely — Notification Preferences, owner approved): per-person admin notification
// preferences. Each event has up to three channels: Bell (in-app list), Phone (push) and Email.
// Saved on admin_users.notification_prefs (jsonb, scripts/notification_prefs.sql).
//
// THE ONE MAP from a notification row (resident_update_notifications.update_type) to an event key.
// Pure (no server imports) so the Settings screen can use the same list.
// COPY of melyos-builder lib/notifyPrefs.ts (the admin app owns the screen) — keep both in sync.
//
// Rules:
//  - No saved prefs (or the column doesn't exist yet) = the defaults below = how it worked before.
//  - A notification type that is not in this map is ALWAYS shown and pushed (never lost).
//  - Critical events can't turn the Bell off.
//  - Marinas keep their own email list (src/lib/marina/marinaNotify.ts); marina-only types are not mapped here.

export type NotifyChannel = "bell" | "phone" | "email";
export type ChannelPrefs = Partial<Record<NotifyChannel, boolean>>;
export type NotificationPrefs = {
  v?: number;
  events?: Record<string, ChannelPrefs>;
  options?: { security_include_ip?: boolean };
  updated_at?: string;
};

export type NotifyCategory = "payments" | "park_money" | "applications" | "residents" | "bookings" | "office" | "security";

export type NotifyEvent = {
  key: string;
  category: NotifyCategory;
  label: string;
  description?: string;
  channels: NotifyChannel[];
  defaults: Record<NotifyChannel, boolean>;
  critical?: boolean;
  /** update_type values written to resident_update_notifications for this event */
  types: string[];
  /** extra check on the message when several events share one update_type */
  match?: RegExp;
};

export const NOTIFY_CATEGORIES: { key: NotifyCategory; title: string; description: string }[] = [
  { key: "payments", title: "Payments", description: "Money coming in from residents and guests." },
  { key: "park_money", title: "Park money", description: "Disputes and payouts on the park's payment account." },
  { key: "applications", title: "Applications", description: "Lease applications and background checks." },
  { key: "residents", title: "Residents", description: "Requests and documents from residents." },
  { key: "bookings", title: "Bookings & sales", description: "Reservations, waitlist, propane and listings." },
  { key: "office", title: "Office", description: "Shifts and system problems." },
  { key: "security", title: "Security", description: "Suspicious activity on the resident portal." },
];

const ALL: NotifyChannel[] = ["bell", "phone", "email"];
const BELL_PHONE = { bell: true, phone: true, email: false };

export const NOTIFY_EVENTS: NotifyEvent[] = [
  // Payments
  { key: "payment_received", category: "payments", label: "Payment received", channels: ALL, defaults: BELL_PHONE,
    types: ["rent_payment", "autopay_charged", "rent_to_own_deposit_paid", "rent_to_own_paid_off"] },
  { key: "ach_returned", category: "payments", label: "Bank (ACH) payment returned", channels: ALL, defaults: BELL_PHONE, critical: true,
    types: ["ach_payment_returned"] },
  { key: "autopay_failed", category: "payments", label: "Autopay failed", channels: ALL, defaults: BELL_PHONE, critical: true,
    types: ["autopay_failed"] },
  { key: "autopay_changed", category: "payments", label: "Autopay turned on / off", channels: ALL, defaults: BELL_PHONE,
    types: ["autopay_enabled", "autopay_disabled"] },
  { key: "late_fee", category: "payments", label: "Invoice late / late fee applied", channels: ALL, defaults: BELL_PHONE,
    types: ["invoice_became_late"] },
  // Park money
  { key: "dispute", category: "park_money", label: "Chargeback / dispute", channels: ALL, defaults: BELL_PHONE, critical: true,
    types: ["payment_dispute"] },
  { key: "instant_payout", category: "park_money", label: "Instant payout sent", channels: ALL, defaults: BELL_PHONE,
    types: ["instant_payout_sent"] },
  // Applications
  { key: "application_fee_paid", category: "applications", label: "Application fee paid", description: "Includes lot conflicts on a paid application", channels: ALL, defaults: BELL_PHONE,
    types: ["application_fee_paid", "occupant_background_check_paid", "application_lot_conflict"] },
  { key: "background_check", category: "applications", label: "Background check result", channels: ALL, defaults: BELL_PHONE,
    types: ["application_background_check_result", "occupant_background_check_result"] },
  // Residents
  { key: "maintenance_request", category: "residents", label: "Maintenance request", channels: ALL, defaults: BELL_PHONE,
    types: ["maintenance_request"] },
  { key: "emergency_report", category: "residents", label: "Emergency reported in the website chat", description: "Email only", channels: ["email"],
    defaults: { bell: false, phone: false, email: true }, types: [] },
  { key: "move_out", category: "residents", label: "Move-out request / cancel", channels: ALL, defaults: BELL_PHONE,
    types: ["move_out_request", "move_out_cancelled"] },
  { key: "agreement_signed", category: "residents", label: "Agreement / addendum signed", channels: ALL, defaults: BELL_PHONE,
    types: ["lease_addendum_signed", "rent_to_own_signature"] },
  { key: "document_uploaded", category: "residents", label: "Document uploaded", channels: ALL, defaults: BELL_PHONE,
    types: ["document_uploaded"] },
  { key: "lease_ending", category: "residents", label: "Lease ending in 30 days", description: "Once per lease", channels: ALL, defaults: BELL_PHONE,
    types: ["lease_ending_soon"] },
  // Bookings & sales
  { key: "reservations", category: "bookings", label: "Reservations", description: "Cancellations and double-booking alerts", channels: ALL, defaults: BELL_PHONE,
    types: ["reservation_cancelled", "double_booking_alert"] },
  { key: "map_widget_reservation", category: "bookings", label: "Map widget / online reservation paid", channels: ALL, defaults: BELL_PHONE,
    types: ["reservation_paid"] },
  { key: "waitlist_signup", category: "bookings", label: "Waitlist sign-up", channels: ALL, defaults: BELL_PHONE,
    types: ["waitlist_signup"] },
  { key: "propane_order", category: "bookings", label: "Propane orders", channels: ALL, defaults: BELL_PHONE,
    types: ["propane_payment"] },
  { key: "real_estate_inquiry", category: "bookings", label: "Real estate inquiry", channels: ALL, defaults: BELL_PHONE,
    types: ["real_estate_inquiry"] },
  // Office
  { key: "shift_left_open", category: "office", label: "Shift left open", description: "Once a day, for a shift from a previous day", channels: ALL, defaults: BELL_PHONE,
    types: ["shift_left_open"] },
  { key: "system_health", category: "office", label: "System health issues", channels: ALL, defaults: BELL_PHONE,
    types: ["system_health_issue", "invoice_creation_failed"] },
  // Security (both use update_type "security_alert"; told apart by the message)
  { key: "security_failed_login", category: "security", label: "Failed logins", channels: ALL, defaults: BELL_PHONE, critical: true,
    types: ["security_alert"], match: /failed login/i },
  { key: "security_password_reset", category: "security", label: "Unrequested password reset", channels: ALL, defaults: BELL_PHONE, critical: true,
    types: ["security_alert"] },
];

export const NOTIFY_EVENT_BY_KEY: Record<string, NotifyEvent> = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, e]));

/** The event a notification row belongs to, or null (= not configurable, always delivered). */
export function eventKeyFor(updateType: string | null | undefined, message?: string | null): string | null {
  const t = String(updateType || "");
  if (!t) return null;
  const hits = NOTIFY_EVENTS.filter((e) => e.types.includes(t));
  if (!hits.length) return null;
  if (hits.length === 1) return hits[0].key;
  const m = String(message || "");
  return (hits.find((e) => e.match && e.match.test(m)) || hits.find((e) => !e.match) || hits[0]).key;
}

/** Reads admin_users.notification_prefs safely (missing column / bad JSON = defaults). */
export function parsePrefs(raw: unknown): NotificationPrefs {
  let v: any = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as NotificationPrefs) : {};
}

/** Does this person want this event on this channel? Unknown event = yes for bell/phone. */
export function wants(prefs: unknown, eventKey: string | null, channel: NotifyChannel): boolean {
  if (!eventKey) return channel !== "email";
  const ev = NOTIFY_EVENT_BY_KEY[eventKey];
  if (!ev) return channel !== "email";
  if (!ev.channels.includes(channel)) return false;
  if (ev.critical && channel === "bell") return true;
  const saved = parsePrefs(prefs).events?.[eventKey]?.[channel];
  return typeof saved === "boolean" ? saved : ev.defaults[channel];
}

type AdminRowPrefs = { notification_prefs?: unknown; notify_maintenance?: boolean | null; notify_security_include_ip?: boolean | null } | null | undefined;

/**
 * Same as wants(), for a whole admin_users row: before the SQL runs (no notification_prefs yet)
 * the old columns still count — the website-chat emergency email follows notify_maintenance.
 */
export function rowWants(row: AdminRowPrefs, eventKey: string | null, channel: NotifyChannel): boolean {
  if (eventKey === "emergency_report" && channel === "email") {
    const saved = parsePrefs(row?.notification_prefs).events?.emergency_report?.email;
    if (typeof saved === "boolean") return saved;
    return row?.notify_maintenance === true; // same as before: .eq("notify_maintenance", true)
  }
  return wants(row?.notification_prefs, eventKey, channel);
}

/** Include the IP in security alerts? New JSON option first, then the old column, default yes. */
export function wantsSecurityIp(row: AdminRowPrefs): boolean {
  const o = parsePrefs(row?.notification_prefs).options?.security_include_ip;
  if (typeof o === "boolean") return o;
  return row?.notify_security_include_ip !== false;
}

/** Full effective table for the Settings screen (saved values over defaults, critical bell forced on). */
export function effectivePrefs(row: AdminRowPrefs): { events: Record<string, Record<NotifyChannel, boolean>>; options: { security_include_ip: boolean } } {
  const events: Record<string, Record<NotifyChannel, boolean>> = {};
  for (const e of NOTIFY_EVENTS) {
    events[e.key] = { bell: rowWants(row, e.key, "bell"), phone: rowWants(row, e.key, "phone"), email: rowWants(row, e.key, "email") };
  }
  return { events, options: { security_include_ip: wantsSecurityIp(row) } };
}

/** Cleans what the browser sends: only known events/channels, booleans, critical bell stays on. */
export function cleanPrefs(input: unknown): NotificationPrefs {
  const src = parsePrefs(input);
  const events: Record<string, ChannelPrefs> = {};
  for (const e of NOTIFY_EVENTS) {
    const s = (src.events as any)?.[e.key];
    if (!s || typeof s !== "object") continue;
    const out: ChannelPrefs = {};
    for (const c of e.channels) if (typeof s[c] === "boolean") out[c] = s[c];
    if (e.critical) out.bell = true;
    if (Object.keys(out).length) events[e.key] = out;
  }
  const options: NotificationPrefs["options"] = {};
  if (typeof (src.options as any)?.security_include_ip === "boolean") options.security_include_ip = (src.options as any).security_include_ip;
  return { v: 2, events, options, updated_at: new Date().toISOString() };
}
