// Oct 24 (per Mely): client-safe Restaurant pieces (no database import).
export type Restaurant = {
  name: string; tagline: string | null; description: string | null; phone: string | null; hours_text: string | null; photo: string | null;
  menu_photos: string[]; menu_pdf: string | null;
  delivery: { label: string; url: string; brand: "ubereats" | "doordash" | "grubhub" | "other" }[];
  reservations_on: boolean; auto_confirm: boolean; open_time: string; close_time: string; slot_minutes: number; max_party: number; lead_hours: number; closed_days: string[];
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayName = (d: Date) => DAYS[d.getDay()];
/** Time slots "HH:MM" between open and close (last seat 1 slot before close). */
export function timeSlots(r: Pick<Restaurant, "open_time" | "close_time" | "slot_minutes">): string[] {
  const [oh, om] = r.open_time.split(":").map(Number); const [ch, cm] = r.close_time.split(":").map(Number);
  const out: string[] = []; const step = Math.max(15, r.slot_minutes || 30);
  for (let t = oh * 60 + om; t <= ch * 60 + cm - step; t += step) out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  return out;
}
export const pretty = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "pm" : "am"; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`; };
