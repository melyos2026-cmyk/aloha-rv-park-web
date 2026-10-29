// Oct 29 (per Mely): the resident bell texts about Rec Hall requests in Spanish / Portuguese
// (+ French / Haitian Creole, Oct 29). PURE
// (no React) so it can also run on the server. The English sentences are written by
// melyos-builder app/api/admin/rv-events (approve / decline / office cancel) — keep them in sync:
//   Your Rec Hall request for November 5, 2026, 2:00 PM–6:00 PM was approved.
//   Your Rec Hall request for November 5, 2026, 2:00 PM–6:00 PM was declined.[ Reason: …]
//   Your Rec Hall booking for November 5, 2026, 2:00 PM–6:00 PM was cancelled by the office.[ Reason: …]
// Used by src/lib/portalI18n.ts translateNotificationMessage (bell / Messages).
import { frElide, langIndex, localizeDateLabel, type NotifLang } from "./notificationI18n";

// [es, pt, fr, ht]
const D: Record<string, [string, string, string, string]> = {
  approved: ["Su solicitud del Rec Hall para el {date}, {start}–{end} fue aprobada.", "Sua solicitação do Rec Hall para {date}, {start}–{end} foi aprovada.", "Votre demande de Rec Hall pour le {date}, {start}–{end}, a été approuvée.", "Demann ou pou Rec Hall la pou {date}, {start}–{end}, apwouve."],
  declined: ["Su solicitud del Rec Hall para el {date}, {start}–{end} fue rechazada.", "Sua solicitação do Rec Hall para {date}, {start}–{end} foi recusada.", "Votre demande de Rec Hall pour le {date}, {start}–{end}, a été refusée.", "Demann ou pou Rec Hall la pou {date}, {start}–{end}, refize."],
  cancelled: ["La oficina canceló su reservación del Rec Hall para el {date}, {start}–{end}.", "O escritório cancelou sua reserva do Rec Hall para {date}, {start}–{end}.", "Le bureau a annulé votre réservation du Rec Hall pour le {date}, {start}–{end}.", "Biwo a anile rezèvasyon Rec Hall ou pou {date}, {start}–{end}."],
  reason: [" Motivo: {reason}", " Motivo: {reason}", " Motif : {reason}", " Rezon: {reason}"],
};

const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

/** "2:00 PM" → "14:00" for es / pt / ht, "14 h 00" for fr (24-hour clock is the norm there). */
function localTime(t: string, lang: NotifLang): string {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(t.trim());
  if (!m) return t;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "P" ? 12 : 0);
  return lang === "fr" ? `${h} h ${m[2]}` : `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function translateRecHallNotice(lang: NotifLang, s: string): string | null {
  if (lang === "en") return null;
  const m = /^Your Rec Hall (?:request|booking) for (.+? \d{4}), (.+?)–(.+?) (was approved|was declined|was cancelled by the office)\.(?: Reason: ([\s\S]+))?$/.exec(s);
  if (!m) return null;
  const i = langIndex(lang);
  const key = m[4] === "was approved" ? "approved" : m[4] === "was declined" ? "declined" : "cancelled";
  const vars = { date: localizeDateLabel(lang, m[1]), start: localTime(m[2], lang), end: localTime(m[3], lang), reason: m[5] || "" };
  const main = fill(D[key][i], vars);
  return (lang === "fr" ? frElide(main) : main) + (m[5] ? fill(D.reason[i], vars) : "");
}
