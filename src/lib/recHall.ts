// Oct 29 (per Mely — "request the Rec Hall" from the resident portal): the rules and time helpers
// shared by the portal card (src/components/RecHallCard.tsx) and /api/portal/rec-hall. Pure (no
// server imports). Times are the park's local time (Eastern, same as Park info). Bookings live in
// rv_events / rv_event_rooms (admin: melyos-builder Rec Hall module); a portal request is a row with
// status 'requested' until the office approves (→ 'booked') or declines (→ 'declined').
// Bell texts built here are matched in src/lib/portalI18n.ts translateNotificationMessage — and the
// admin app (melyos-builder app/api/admin/rv-events) builds the same English sentences.

export const REC_HALL_TZ = "America/New_York";
export const REC_HALL_RULES = {
  openFrom: "07:00",
  openUntil: "23:00",
  stepMinutes: 30,
  minMinutes: 30,
  maxHours: 8,
  maxDaysAhead: 90,
  maxPending: 3,
  maxGuests: 500,
};

const pad = (n: number) => String(n).padStart(2, "0");
export const toMin = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
export const fromMin = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function zoneParts(d: Date, tz = REC_HALL_TZ) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute"), s: g("second") };
}

/** Park-local "YYYY-MM-DD" + "HH:MM" → the real instant. */
export function parkToDate(ymd: string, hhmm: string, tz = REC_HALL_TZ): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  const min = toMin(hhmm);
  if (!dm || isNaN(min)) return null;
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Math.floor(min / 60), min % 60);
  const offsetAt = (t: number) => { const z = zoneParts(new Date(t), tz); return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - t; };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  const out = new Date(t);
  return isNaN(out.getTime()) ? null : out;
}

/** Today's date at the park, "YYYY-MM-DD". */
export function parkToday(now = new Date()): string {
  const z = zoneParts(now);
  return `${z.y}-${pad(z.mo)}-${pad(z.d)}`;
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** An instant as park-local "HH:MM". */
export function parkHM(iso: string | Date): string {
  const z = zoneParts(new Date(iso));
  return `${pad(z.h)}:${pad(z.mi)}`;
}

/** "2:00 PM" (park time) — English, as stored in bell texts. */
export function parkTimeLabel(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: REC_HALL_TZ, hour: "numeric", minute: "2-digit" }).replace(/ /g, " ");
}
/** "November 5, 2026" (park date) — English, as stored in bell texts. */
export function parkDateLabel(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: REC_HALL_TZ, month: "long", day: "numeric", year: "numeric" });
}
/** "November 5, 2026, 2:00 PM–6:00 PM" */
export function recHallWhen(startsAt: string | Date, endsAt: string | Date): string {
  return `${parkDateLabel(startsAt)}, ${parkTimeLabel(startsAt)}–${parkTimeLabel(endsAt)}`;
}

/** Start times offered in the form (every 30 min, last one leaves room for the shortest request). */
export function startOptions(): string[] {
  const out: string[] = [];
  for (let m = toMin(REC_HALL_RULES.openFrom); m <= toMin(REC_HALL_RULES.openUntil) - REC_HALL_RULES.minMinutes; m += REC_HALL_RULES.stepMinutes) out.push(fromMin(m));
  return out;
}
/** End times offered for a start time (min length → max length, never past closing). */
export function endOptions(start: string): string[] {
  const s = toMin(start);
  if (isNaN(s)) return [];
  const out: string[] = [];
  const last = Math.min(s + REC_HALL_RULES.maxHours * 60, toMin(REC_HALL_RULES.openUntil));
  for (let m = s + REC_HALL_RULES.minMinutes; m <= last; m += REC_HALL_RULES.stepMinutes) out.push(fromMin(m));
  return out;
}

export type RecHallCheck = { error: string; vars?: Record<string, string | number> } | { start: Date; end: Date };

/** The request rules. Errors are English portal keys (translated in portalI18n). */
export function checkRecHallRequest(p: { date: string; start: string; end: string; title: string; guests: unknown; capacity?: number | null }, now = new Date()): RecHallCheck {
  const R = REC_HALL_RULES;
  if (!p.date || !p.start || !p.end) return { error: "Choose a date, a start time and an end time." };
  const sMin = toMin(p.start), eMin = toMin(p.end);
  const start = parkToDate(p.date, p.start), end = parkToDate(p.date, p.end);
  if (!start || !end || isNaN(sMin) || isNaN(eMin)) return { error: "Choose a date, a start time and an end time." };
  if (eMin <= sMin) return { error: "The end time must be after the start time." };
  if (sMin < toMin(R.openFrom) || eMin > toMin(R.openUntil)) return { error: "The Rec Hall can be requested between 7:00 AM and 11:00 PM." };
  if (eMin - sMin < R.minMinutes) return { error: "A request must be at least 30 minutes long." };
  if (eMin - sMin > R.maxHours * 60) return { error: "A request can be at most 8 hours long." };
  const today = parkToday(now);
  if (p.date < today || start.getTime() <= now.getTime()) return { error: "Please choose a date and time that haven't passed." };
  if (p.date > addDays(today, R.maxDaysAhead)) return { error: "You can request the Rec Hall up to 90 days ahead." };
  if (!String(p.title || "").trim()) return { error: "Please enter the event name." };
  const g = Number(p.guests);
  if (!Number.isInteger(g) || g < 1 || g > R.maxGuests) return { error: "Please enter how many guests (1 or more)." };
  if (p.capacity && g > p.capacity) return { error: "The Rec Hall fits up to {n} people.", vars: { n: p.capacity } };
  return { start, end };
}

export type RecHallStatus = "requested" | "booked" | "declined" | "canceled" | "done";
/** Portal label for an rv_events status (English key, translated in portalI18n). */
export function recHallStatusLabel(s: string): string {
  return s === "requested" ? "Requested" : s === "booked" ? "Approved" : s === "declined" ? "Declined" : s === "done" ? "Completed" : "Cancelled";
}
