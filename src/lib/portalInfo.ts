// Oct 28 (per Mely): "Resident Portal Info" — what to do in an emergency and office hours, shown in
// every RV resident portal with the park rules and the after-hours note.
// Stored in park_settings.lease_defaults.portal_info (lib/leaseDefaultsFlag.ts writeLeaseValue).
// NOT stored here (one source each, read live):
//   - park rules -> lease_defaults.park_rules (Lease Defaults -> Park Rules, the rules applicants agree to)
//   - emergency phone -> companies.emergency_phone (also used by the Mely chat); falls back to the office phone
//   - office phone -> companies.contact_phone || companies.phone
//   - after-hours fee -> company_fee_settings.after_hours_fee / charge_after_hours (Fee Settings)
// Pure (no server imports) so the admin editor, the admin route and — as an identical copy —
// aloha-rv-park-web/src/lib/portalInfo.ts all share the same shape, defaults and "open now" rule.
// KEEP BOTH COPIES IN SYNC.

export const PORTAL_INFO_KEY = "portal_info";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
];

export type DayHours = { closed: boolean; open: string; close: string }; // "HH:MM" 24h
// Oct 28 (per Mely): two groups. "911" = call 9-1-1 first (red, top), then notify the park.
// "park" = call the park's emergency line (tap-to-call; phone blank = the emergency phone).
export type EmergencyGroup = "911" | "park";
export type Emergency = { id: string; group: EmergencyGroup; title: string; steps: string; phone: string };

export type PortalInfo = {
  emergencies: Emergency[];
  hours_mode: "weekly" | "text";
  hours: Record<DayKey, DayHours>;
  hours_text: string;               // used when hours_mode = "text"
  hours_note: string;               // e.g. "Closed on major holidays"
  updated_at?: string | null;
  updated_by?: string | null;
};

const A = (id: string, title: string, steps: string): Emergency => ({ id, group: "911", title, steps, phone: "" });
const B = (id: string, title: string, steps: string): Emergency => ({ id, group: "park", title, steps, phone: "" });

export const DEFAULT_EMERGENCIES: Emergency[] = [
  A("fire", "Fire or smoke", "Get everyone out and away from the RV or home, then call 911. Do not go back inside. Give the park's address and your lot number."),
  A("medical", "Medical emergency", "Someone is hurt, not breathing, has chest pain or is unconscious: call 911 right away and follow the dispatcher's instructions. Give the park's address and your lot number."),
  A("crime", "Crime in progress, violence or someone in danger", "Get to a safe place and call 911. Do not confront anyone."),
  A("gas_danger", "Strong gas smell or propane leak", "Leave the area first. Do not use flames, light switches, phones or anything that can spark near it. From a safe place, upwind, call 911."),
  A("accident", "Car accident with injuries", "Call 911. Do not move anyone who is hurt unless they are in immediate danger."),
  A("weather_danger", "Severe weather with immediate danger", "Tornado warning or water flooding inside your RV: go to a sturdy building or public shelter now — an RV is not safe shelter. Call 911 if anyone is trapped or in danger."),
  A("power_line", "Downed or sparking power line", "Stay at least 30 feet away and keep others away. Never touch the line or anything it is touching. Call 911."),
  B("power", "Power out at your site", "Check whether your neighbors also lost power. If only your site is out, reset the breaker on your pedestal and your RV's main breaker. If that does not fix it, call the park's emergency line. If the whole park is out, staff are already working on it."),
  B("water", "No water or a water leak", "Check that your spigot valve is open and your hose is not kinked. If water is gushing or leaking from a park line, call the park's emergency line right away. If the whole park is out, staff are already working on it."),
  B("sewer", "Sewer or plumbing backup", "Stop using water and do not flush. Close the water at your spigot. If sewage is coming out of the park's sewer connection or flooding your site, call the park's emergency line. A clog inside your RV or home is the resident's responsibility."),
  B("propane_small", "Small propane issue (no smell of danger)", "Close the tank valve and do not use the appliance. Call the park's emergency line. If you smell gas strongly, leave the area and call 911 instead."),
  B("damage", "Fallen tree or storm damage", "Stay clear of the damage and of any wires. Call the park's emergency line. If a wire is down or anyone is hurt, call 911 first."),
  B("lockout", "Locked out", "Call the park's emergency line. Staff may not be able to open your RV or home, but can help you find a locksmith."),
  B("hurricane_prep", "Hurricane or tropical storm coming", "Follow official alerts from local emergency management and the National Weather Service. Secure or bring in awnings, chairs, grills and anything that can blow away. Know your evacuation route and leave when an evacuation order is issued. Call the park's emergency line for park-related questions."),
];

const weekday = (open: string, close: string): DayHours => ({ closed: false, open, close });
const closedDay: DayHours = { closed: true, open: "09:00", close: "17:00" };

export function defaultHours(parkId?: string | null): Record<DayKey, DayHours> {
  // Aloha's hours were already in the Mely chat (Mon–Fri 10–5, Sat 10–3, Sun closed).
  if (parkId === "aloha") {
    const wk = weekday("10:00", "17:00");
    return { mon: wk, tue: wk, wed: wk, thu: wk, fri: wk, sat: weekday("10:00", "15:00"), sun: closedDay };
  }
  const wk = weekday("09:00", "17:00");
  return { mon: wk, tue: wk, wed: wk, thu: wk, fri: wk, sat: closedDay, sun: closedDay };
}

export function defaultPortalInfo(parkId?: string | null): PortalInfo {
  return {
    emergencies: DEFAULT_EMERGENCIES.map((e) => ({ ...e })),
    hours_mode: "weekly",
    hours: defaultHours(parkId),
    hours_text: "",
    hours_note: "",
  };
}

const s = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").slice(0, max);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Cleans anything (saved JSON or a request body) into a valid PortalInfo. */
export function normalizePortalInfo(raw: any, parkId?: string | null): PortalInfo {
  const base = defaultPortalInfo(parkId);
  if (!raw || typeof raw !== "object") return base;
  const hours = { ...base.hours };
  for (const d of DAYS) {
    const h = raw.hours?.[d.key];
    if (h && typeof h === "object") {
      hours[d.key] = {
        closed: h.closed === true,
        open: TIME_RE.test(String(h.open)) ? String(h.open) : base.hours[d.key].open,
        close: TIME_RE.test(String(h.close)) ? String(h.close) : base.hours[d.key].close,
      };
    }
  }
  let emergencies: Emergency[] = Array.isArray(raw.emergencies)
    ? raw.emergencies.slice(0, 40).map((x: any, i: number) => ({
        id: s(x?.id, 60).trim() || `custom_${i}_${Date.now().toString(36)}`,
        group: (x?.group === "911" ? "911" : "park") as EmergencyGroup,
        title: s(x?.title, 120).trim(),
        steps: s(x?.steps, 2000).trim(),
        phone: x?.group === "911" ? "" : s(x?.phone, 40).trim(),
      })).filter((x: Emergency) => x.title || x.steps)
    : base.emergencies;
  // 911 group always first, order kept inside each group.
  emergencies = [...emergencies.filter((x) => x.group === "911"), ...emergencies.filter((x) => x.group === "park")];
  return {
    emergencies,
    hours_mode: raw.hours_mode === "text" ? "text" : "weekly",
    hours,
    hours_text: s(raw.hours_text, 1000),
    hours_note: s(raw.hours_note, 300).trim(),
    updated_at: raw.updated_at ? String(raw.updated_at) : null,
    updated_by: raw.updated_by ? String(raw.updated_by) : null,
  };
}

export type ParkRuleLite = { title: string; text: string };
/** lease_defaults.park_rules -> clean list (empty entries dropped). */
export function parkRulesFrom(leaseDefaults: any): ParkRuleLite[] {
  const r = leaseDefaults?.park_rules;
  if (!Array.isArray(r)) return [];
  return r.map((x: any) => ({ title: String(x?.title || "").trim(), text: String(x?.text || "").trim() })).filter((x) => x.title || x.text);
}

/** Digits for a tel: link ("(407) 555-0100" -> "tel:4075550100"; keeps a leading +). */
export function telHref(phone: string): string {
  const p = String(phone || "").trim();
  return `tel:${p.startsWith("+") ? "+" : ""}${p.replace(/[^0-9]/g, "")}`;
}

export function fmtTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return t;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function dayLine(h: DayHours): string {
  return h.closed ? "Closed" : `${fmtTime(h.open)} – ${fmtTime(h.close)}`;
}

/** Days with the same hours grouped: "Mon–Fri 10:00 AM – 5:00 PM", "Sat 10:00 AM – 3:00 PM", "Sun Closed". */
export function groupedHours(hours: Record<DayKey, DayHours>): { days: string; hours: string }[] {
  const out: { days: string; hours: string; from: number; to: number }[] = [];
  DAYS.forEach((d, i) => {
    const line = dayLine(hours[d.key]);
    const last = out[out.length - 1];
    if (last && last.hours === line && last.to === i - 1) last.to = i;
    else out.push({ days: "", hours: line, from: i, to: i });
  });
  return out.map((g) => ({
    days: g.from === g.to ? DAYS[g.from].short : `${DAYS[g.from].short}–${DAYS[g.to].short}`,
    hours: g.hours,
  }));
}

/** Is the office open right now (America/New_York)? null when hours are free text. */
export function openNowET(info: Pick<PortalInfo, "hours_mode" | "hours">, now: Date = new Date()): boolean | null {
  if (info.hours_mode !== "weekly") return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const wd = (parts.find((p) => p.type === "weekday")?.value || "").slice(0, 3).toLowerCase() as DayKey;
  const hh = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const mm = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const h = info.hours[wd];
  if (!h || h.closed) return false;
  const toMin = (t: string) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
  const cur = hh * 60 + mm;
  return cur >= toMin(h.open) && cur < toMin(h.close);
}

export function afterHoursSentence(charge: boolean, fee: number): string | null {
  if (!charge || !(fee > 0)) return null;
  return `Non-emergency calls after office hours have a $${fee.toFixed(2)} inconvenience fee.`;
}

/** Plain-text summary for the Mely chat system prompt. */
export function portalInfoForChat(p: {
  info: PortalInfo; configured: boolean; officePhone: string; emergencyPhone: string; afterHours: string | null;
}): string {
  const lines: string[] = [];
  if (p.configured) {
    if (p.info.hours_mode === "weekly") {
      lines.push(`Office hours (Eastern Time): ${groupedHours(p.info.hours).map((g) => `${g.days} ${g.hours}`).join("; ")}.${p.info.hours_note ? ` ${p.info.hours_note}.` : ""} Use the current date and time above to say whether the office is open right now.`);
    } else if (p.info.hours_text.trim()) {
      lines.push(`Office hours: ${p.info.hours_text.trim().replace(/\n+/g, "; ")}.${p.info.hours_note ? ` ${p.info.hours_note}.` : ""}`);
    }
  }
  if (p.officePhone) lines.push(`Office phone: ${p.officePhone}.`);
  if (p.emergencyPhone) lines.push(`Park emergency line: ${p.emergencyPhone}.`);
  lines.push(p.afterHours ? `After-hours fee: ${p.afterHours} It applies to non-emergency calls only.` : "The park does not charge a fee for after-hours calls.");
  const nine = p.info.emergencies.filter((x) => x.group === "911");
  const park = p.info.emergencies.filter((x) => x.group === "park");
  lines.push(`CALL 9-1-1 FIRST for these (then also notify the park${p.emergencyPhone ? ` at ${p.emergencyPhone}` : ""}):`);
  for (const x of nine) lines.push(`- ${x.title}: ${x.steps}`);
  if (!nine.length) lines.push("- Fire, medical emergencies, crime or anyone in danger, a strong gas smell, downed power lines.");
  lines.push(`Call the park's emergency line${p.emergencyPhone ? ` (${p.emergencyPhone})` : ""} for these:`);
  for (const x of park) lines.push(`- ${x.title}: ${x.steps}${x.phone ? ` Call ${x.phone}.` : ""}`);
  return lines.join("\n");
}
