// Oct 29 (per Mely — residents get their phone alerts in their own language): the resident bell /
// push message templates in English / Spanish / Portuguese / French / Haitian Creole. PURE module — no React, no window — so
// the same patterns run in the portal (src/lib/portalI18n.ts imports this) and on the server
// (melyos-builder app/api/push/dispatch sends the resident's push in their portal_language).
//
// ⚠ TWO IDENTICAL COPIES: aloha-rv-park-web/src/lib/notificationI18n.ts and
//   melyos-builder/lib/notificationI18n.ts. Edit one, then copy it over the other
//   (melyos-builder/scripts/checks/notification-i18n-sync.sh copies + checks). Never edit just one.
//
// The server stores ENGLISH text (never changed); anything not matched here stays in English.

export type NotifLang = "en" | "es" | "pt" | "fr" | "ht";
// Oct 29: rows are [es, pt, fr, ht] — French (Canada) and Haitian Creole added (Quebec snowbirds,
// Haitian residents).
export type NotifDict = Record<string, [string, string, string, string]>;
export type NotifVars = Record<string, string | number | null | undefined>;

// Haitian Creole has no Intl data (Node and browsers fall back to English): numbers and the date
// layout use French (Haiti), and month / weekday names are swapped for Kreyòl ones (intlDateText).
export const NOTIF_LOCALES: Record<NotifLang, string> = { en: "en-US", es: "es-US", pt: "pt-BR", fr: "fr-CA", ht: "fr-HT" };

export function isNotifLang(x: unknown): x is NotifLang {
  return x === "en" || x === "es" || x === "pt" || x === "fr" || x === "ht";
}

/** Column of a dictionary row for this language (English has none: the key is the English text). */
export function langIndex(lang: Exclude<NotifLang, "en">): 0 | 1 | 2 | 3 {
  return lang === "es" ? 0 : lang === "pt" ? 1 : lang === "fr" ? 2 : 3;
}

/** French elision before month names that start with a vowel: "de octobre" → "d'octobre". */
export function frElide(s: string): string {
  return s.replace(/\b([dD])e (avril|août|octobre)\b/g, "$1'$2");
}

const HT_MONTHS = ["janvye", "fevriye", "mas", "avril", "me", "jen", "jiyè", "out", "septanm", "oktòb", "novanm", "desanm"];
const HT_MONTHS_SHORT = ["jan.", "fev.", "mas", "avr.", "me", "jen", "jiy.", "out", "sept.", "okt.", "nov.", "des."];
const HT_DAYS = ["dimanch", "lendi", "madi", "mèkredi", "jedi", "vandredi", "samdi"];
const HT_DAYS_SHORT = ["dim.", "len.", "mad.", "mèk.", "jed.", "van.", "sam."];
const EN_DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DT_FIELDS = ["weekday", "era", "year", "month", "day", "hour", "minute", "second", "dateStyle", "timeStyle"] as const;

/**
 * A date as text in this language — same as toLocaleDateString (kind "date") / toLocaleString
 * (kind "datetime"), except Haitian Creole: French (Haiti) layout with Kreyòl month / day names.
 */
export function intlDateText(lang: NotifLang, d: Date, opts: Intl.DateTimeFormatOptions = {}, kind: "date" | "datetime" = "date"): string {
  const loc = NOTIF_LOCALES[lang] || "en-US";
  if (lang !== "ht") {
    const out = kind === "date" ? d.toLocaleDateString(loc, opts) : d.toLocaleString(loc, opts);
    return lang === "fr" ? out.replace(/(^|[^\d])1 (?=\p{L})/u, "$11er ") : out; // "1 novembre" → "1er novembre"
  }
  let o = opts;
  const has = (k: (typeof DT_FIELDS)[number]) => (opts as Record<string, unknown>)[k] !== undefined;
  if (!DT_FIELDS.some(has)) {
    o = { ...opts, year: "numeric", month: "numeric", day: "numeric", ...(kind === "datetime" ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : {}) };
  } else if (kind === "date" && !has("dateStyle") && !has("year") && !has("month") && !has("day") && !has("weekday")) {
    o = { ...opts, year: "numeric", month: "numeric", day: "numeric" };
  }
  const en = (x: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...x, timeZone: o.timeZone }).format(d);
  const longMonth = o.month === "long" || (!o.month && (o.dateStyle === "long" || o.dateStyle === "full"));
  const longDay = o.weekday === "long" || (!o.weekday && o.dateStyle === "full");
  return new Intl.DateTimeFormat(loc, o).formatToParts(d).map((p) => {
    if (p.type === "month" && !/^\d+$/.test(p.value)) {
      const m = Number(en({ month: "numeric" })) - 1;
      return (longMonth ? HT_MONTHS : HT_MONTHS_SHORT)[m] ?? p.value;
    }
    if (p.type === "weekday") {
      const w = EN_DAYS_SHORT.indexOf(en({ weekday: "short" }));
      return w < 0 ? p.value : (longDay ? HT_DAYS : HT_DAYS_SHORT)[w];
    }
    return p.value;
  }).join("");
}

export function fillVars(s: string, vars?: NotifVars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

function tr(dict: NotifDict, lang: NotifLang, key: string, vars?: NotifVars): string {
  if (lang === "en") return fillVars(key, vars);
  const row = dict[key];
  return fillVars(row?.[langIndex(lang)] ?? key, vars);
}

function trStatus(dict: NotifDict, lang: NotifLang, value: string): string {
  if (lang === "en" || !value) return value;
  const row = dict["status:" + value] || dict[value];
  return row?.[langIndex(lang)] ?? value;
}

const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Dates by locale. Accepts a Date, a timestamp, "YYYY-MM-DD" (shown as that calendar day, no
 * time-zone shift) or an ISO date-time. Anything unparseable is returned as-is.
 */
export function formatDate(lang: NotifLang, value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (value === null || value === undefined || value === "") return "";
  const s = typeof value === "string" ? value : "";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let d: Date;
  let o = opts;
  if (dateOnly) {
    d = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    o = { ...opts, timeZone: "UTC" };
  } else {
    d = value instanceof Date ? value : new Date(value);
  }
  if (isNaN(d.getTime())) return String(value);
  try { return intlDateText(lang, d, o); } catch { return d.toLocaleDateString("en-US", o); }
}

/**
 * English labels the server builds — "November 1, 2026", "Nov 1, 2026", "July 2026" — shown in the
 * resident's language. ISO dates work too. Anything else comes back unchanged.
 */
export function localizeDateLabel(lang: NotifLang, label: string | null | undefined, long = true): string {
  if (!label) return "";
  const s = String(label).trim();
  if (lang === "en") return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return formatDate(lang, s.slice(0, 10), long ? { month: "long", day: "numeric", year: "numeric" } : undefined);
  const md = /^([A-Za-z]+)\.? (\d{1,2}), (\d{4})$/.exec(s);
  const my = /^([A-Za-z]+) (\d{4})$/.exec(s);
  const monthIdx = (name: string) => EN_MONTHS.findIndex((m) => m === name.toLowerCase() || m.slice(0, 3) === name.toLowerCase().slice(0, 3));
  if (md) {
    const m = monthIdx(md[1]);
    if (m < 0) return s;
    const iso = `${md[3]}-${String(m + 1).padStart(2, "0")}-${String(Number(md[2])).padStart(2, "0")}`;
    return formatDate(lang, iso, long ? { month: "long", day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  if (my) {
    const m = monthIdx(my[1]);
    if (m < 0) return s;
    return formatDate(lang, `${my[2]}-${String(m + 1).padStart(2, "0")}-01`, { month: "long", year: "numeric" });
  }
  return s;
}

/** "October 2026", "October 2026 and November 2026", "your invoice" (server bell text) in this language. */
function localizeMonthList(dict: NotifDict, lang: NotifLang, list: string): string {
  const v = list.trim();
  if (v === "your invoice") return tr(dict, lang, "notif:your invoice");
  const parts = v.split(/, | and /).map((x) => localizeDateLabel(lang, x.trim()));
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")}${tr(dict, lang, "notif: and ")}${parts[parts.length - 1]}`;
}

/**
 * The resident's bell / Messages / push rows. Every resident_facing template written by either app
 * (melyos-builder + aloha-rv-park-web) is matched here. null = not a known template.
 * `dict` defaults to NOTIF_DICT (server); the portal passes its full dictionary (which includes
 * NOTIF_DICT) so charge names / document titles from the UI dictionary are translated too.
 * Keep in sync with: melyos-builder lib/monthlyInvoices.ts (invoice ready), app/api/admin/
 * electric-readings (recorded/corrected), charge-resident + resident-invoices (charges, office
 * payment), maintenance-requests, lease-addenda + lib/residentAgreementsAuto.ts, announcements,
 * cron/apply-invoice-late-fees; aloha: checkr-webhook, rvCardAutopay/rvBankAutopay, stripe-webhook.
 */
export function translateNotificationTemplate(lang: NotifLang, s: string, dict: NotifDict = NOTIF_DICT): string | null {
  if (lang === "en") return s;
  let m: RegExpExecArray | null;
  const T = (key: string, vars?: NotifVars) => {
    const out = tr(dict, lang, key, vars).replace("referente a sua fatura", "referente à sua fatura");
    return lang === "fr" ? frElide(out) : out;
  };
  if ((m = /^Your (.+?) invoice is ready — total due (\$[\d.,]+), due (.+)\.$/.exec(s)))
    return T("Your {month} invoice is ready — total due {amount}, due {date}.", { month: localizeDateLabel(lang, m[1]), amount: m[2], date: localizeDateLabel(lang, m[3]) });
  if ((m = /^A late fee of (\$[\d.,]+) was added to your (.+?) invoice\. New balance: (\$[\d.,]+)\.$/.exec(s)))
    return m[2] === "current"
      ? T("A late fee of {amount} was added to your current invoice. New balance: {balance}.", { amount: m[1], balance: m[3] })
      : T("A late fee of {amount} was added to your {month} invoice. New balance: {balance}.", { amount: m[1], month: localizeDateLabel(lang, m[2]), balance: m[3] });
  if ((m = /^We received your payment of (\$[\d.,]+) for (.+)\. Thank you!$/.exec(s)))
    return T("We received your payment of {amount} for {month}. Thank you!", { amount: m[1], month: localizeMonthList(dict, lang, m[2]) });
  if ((m = /^Your bank payment of (\$[\d.,]+) is processing \(3–5 business days\)\.$/.exec(s)))
    return T("Your bank payment of {amount} is processing (3–5 business days).", { amount: m[1] });
  if ((m = /^Your bank payment of (\$[\d.,]+) for (.+) was returned by your bank\. The (invoice is|invoices are) open again(?:, plus a returned-payment fee of (\$[\d.,]+))?\.$/.exec(s))) {
    const vars = { amount: m[1], month: localizeMonthList(dict, lang, m[2]), fee: m[4] };
    const plural = m[3] === "invoices are";
    return T(`Your bank payment of {amount} for {month} was returned by your bank. ${plural ? "The invoices are" : "The invoice is"} open again${m[4] ? ", plus a returned-payment fee of {fee}" : ""}.`, vars);
  }
  if ((m = /^Your electric reading for (.+?) was (recorded|corrected): ([\d.,]+) kWh used(?: — (\$[\d.,]+) (added to your invoice|on your invoice))?\.$/.exec(s))) {
    const key = `Your electric reading for {month} was ${m[2]}: {usage} kWh used${m[4] ? ` — {amount} ${m[5]}` : ""}.`;
    return T(key, { month: localizeDateLabel(lang, m[1]), usage: m[3], amount: m[4] });
  }
  if ((m = /^A new charge was added to your invoice: ([\s\S]+) — (\$[\d.,]+)\.$/.exec(s)))
    return T("A new charge was added to your invoice: {what} — {amount}.", { what: trStatus(dict, lang, m[1]), amount: m[2] });
  if ((m = /^A maintenance charge was added to your invoice: ([\s\S]+) — (\$[\d.,]+)\.$/.exec(s)))
    return T("A maintenance charge was added to your invoice: {what} — {amount}.", { what: trStatus(dict, lang, m[1]), amount: m[2] });
  if ((m = /^Your maintenance request status changed to "(.*)"\.$/.exec(s)))
    return T('Your maintenance request status changed to "{status}".', { status: dict["maint:" + m[1]] ? T("maint:" + m[1]) : trStatus(dict, lang, m[1]) });
  if (s === "The office added an update to your maintenance request.") return T(s);
  if ((m = /^([\s\S]+) added "([\s\S]+)" to your resident portal for you to review and sign\.$/.exec(s)))
    return T('{park} added "{title}" to your resident portal for you to review and sign.', { park: m[1], title: trStatus(dict, lang, m[2]) });
  if ((m = /^([\s\S]+) sent you "([\s\S]+)" to review and sign in your resident portal\.$/.exec(s)))
    return T('{park} sent you "{title}" to review and sign in your resident portal.', { park: m[1], title: trStatus(dict, lang, m[2]) });
  if ((m = /^New announcement: "([\s\S]*)"$/.exec(s))) return T('New announcement: "{title}"', { title: m[1] });
  if ((m = /^Background check for (.+) \(household occupant of (.+)\): ([\s\S]+)\.$/.exec(s)))
    return T("Background check for {name} (household occupant of {resident}): {result}.", { name: m[1], resident: m[2], result: dict["bgc:" + m[3]] ? T("bgc:" + m[3]) : m[3] });
  if (dict[s]) return T(s); // fixed texts (e.g. the autopay-failed notices)
  return null;
}

/** Server use: never throws, unknown text / any error → the English text unchanged. */
export function translateNotificationOrEnglish(lang: unknown, s: string): string {
  try {
    if (!isNotifLang(lang) || lang === "en" || !s) return s;
    return translateNotificationTemplate(lang, s) ?? s;
  } catch {
    return s;
  }
}

// English → [Spanish, Brazilian Portuguese, French (Canada), Haitian Creole]. Only the notification texts; the portal's UI
// dictionary (portalI18n.ts DICT) spreads this in.
export const NOTIF_DICT: NotifDict = {
  // Oct 29: resident bell notices written by lib/rvCardAutopay.ts / lib/rvBankAutopay.ts (exact text).
  "Autopay could not charge your card, so autopay was turned off. Please pay your invoice by hand, or update your card and turn autopay on again.": ["El pago automático no pudo cobrar su tarjeta, así que se desactivó. Pague su factura manualmente, o actualice su tarjeta y vuelva a activar el pago automático.", "O pagamento automático não conseguiu cobrar seu cartão, então foi desativado. Pague sua fatura manualmente, ou atualize seu cartão e ative o pagamento automático novamente.", "Le paiement automatique n'a pas pu débiter votre carte; il a donc été désactivé. Veuillez payer votre facture manuellement, ou mettez votre carte à jour et réactivez le paiement automatique.", "Peman otomatik la pa t kapab chaje kat ou, kidonk yo etenn li. Tanpri peye fakti ou ak men w, oswa mete kat ou ajou epi limen peman otomatik la ankò."],
  "Autopay could not take your bank payment, so autopay was turned off. Please pay your invoice by hand, or set up autopay again.": ["El pago automático no pudo cobrar de su cuenta bancaria, así que se desactivó. Pague su factura manualmente, o configure el pago automático de nuevo.", "O pagamento automático não conseguiu debitar sua conta bancária, então foi desativado. Pague sua fatura manualmente, ou configure o pagamento automático novamente.", "Le paiement automatique n'a pas pu prélever votre paiement bancaire; il a donc été désactivé. Veuillez payer votre facture manuellement, ou configurez de nouveau le paiement automatique.", "Peman otomatik la pa t kapab retire peman an nan bank ou, kidonk yo etenn li. Tanpri peye fakti ou ak men w, oswa mete peman otomatik la ankò."],
  // ---- Resident bell / Messages templates (translateNotificationMessage — server text stays English) ----
  "notif:your invoice": ["su factura", "sua fatura", "votre facture", "fakti ou"],
  "notif: and ": [" y ", " e ", " et ", " ak "],
  "Your {month} invoice is ready — total due {amount}, due {date}.": ["Su factura de {month} está lista: total a pagar {amount}, vence el {date}.", "Sua fatura de {month} está pronta: total a pagar {amount}, vencimento em {date}.", "Votre facture de {month} est prête — total à payer {amount}, échéance le {date}.", "Fakti pou {month} pare — total pou peye {amount}, dat limit {date}."],
  "A late fee of {amount} was added to your {month} invoice. New balance: {balance}.": ["Se agregó un recargo por pago tardío de {amount} a su factura de {month}. Nuevo saldo: {balance}.", "Uma multa por atraso de {amount} foi adicionada à sua fatura de {month}. Novo saldo: {balance}.", "Des frais de retard de {amount} ont été ajoutés à votre facture de {month}. Nouveau solde : {balance}.", "Yo ajoute yon frè reta {amount} sou fakti pou {month}. Nouvo balans: {balance}."],
  "A late fee of {amount} was added to your current invoice. New balance: {balance}.": ["Se agregó un recargo por pago tardío de {amount} a su factura actual. Nuevo saldo: {balance}.", "Uma multa por atraso de {amount} foi adicionada à sua fatura atual. Novo saldo: {balance}.", "Des frais de retard de {amount} ont été ajoutés à votre facture actuelle. Nouveau solde : {balance}.", "Yo ajoute yon frè reta {amount} sou fakti ou genyen kounye a. Nouvo balans: {balance}."],
  "We received your payment of {amount} for {month}. Thank you!": ["Recibimos su pago de {amount} correspondiente a {month}. ¡Gracias!", "Recebemos seu pagamento de {amount} referente a {month}. Obrigado!", "Nous avons reçu votre paiement de {amount} pour {month}. Merci!", "Nou resevwa peman {amount} ou fè pou {month}. Mèsi!"],
  "Your bank payment of {amount} is processing (3–5 business days).": ["Su pago bancario de {amount} está en proceso (de 3 a 5 días hábiles).", "Seu pagamento bancário de {amount} está em processamento (de 3 a 5 dias úteis).", "Votre paiement bancaire de {amount} est en traitement (3 à 5 jours ouvrables).", "Peman labank {amount} ou a ap trete (3 a 5 jou ouvrab)."],
  "Your bank payment of {amount} for {month} was returned by your bank. The invoice is open again.": ["Su banco devolvió su pago bancario de {amount} correspondiente a {month}. La factura vuelve a estar pendiente de pago.", "Seu banco devolveu seu pagamento bancário de {amount} referente a {month}. A fatura está em aberto novamente.", "Votre banque a retourné votre paiement bancaire de {amount} pour {month}. La facture est de nouveau ouverte.", "Bank ou voye tounen peman labank {amount} ou te fè pou {month}. Fakti a louvri ankò."],
  "Your bank payment of {amount} for {month} was returned by your bank. The invoices are open again.": ["Su banco devolvió su pago bancario de {amount} correspondiente a {month}. Las facturas vuelven a estar pendientes de pago.", "Seu banco devolveu seu pagamento bancário de {amount} referente a {month}. As faturas estão em aberto novamente.", "Votre banque a retourné votre paiement bancaire de {amount} pour {month}. Les factures sont de nouveau ouvertes.", "Bank ou voye tounen peman labank {amount} ou te fè pou {month}. Fakti yo louvri ankò."],
  "Your bank payment of {amount} for {month} was returned by your bank. The invoice is open again, plus a returned-payment fee of {fee}.": ["Su banco devolvió su pago bancario de {amount} correspondiente a {month}. La factura vuelve a estar pendiente de pago, más un cargo por pago devuelto de {fee}.", "Seu banco devolveu seu pagamento bancário de {amount} referente a {month}. A fatura está em aberto novamente, com uma taxa de pagamento devolvido de {fee}.", "Votre banque a retourné votre paiement bancaire de {amount} pour {month}. La facture est de nouveau ouverte, avec des frais de paiement retourné de {fee}.", "Bank ou voye tounen peman labank {amount} ou te fè pou {month}. Fakti a louvri ankò, plis yon frè peman retounen {fee}."],
  "Your bank payment of {amount} for {month} was returned by your bank. The invoices are open again, plus a returned-payment fee of {fee}.": ["Su banco devolvió su pago bancario de {amount} correspondiente a {month}. Las facturas vuelven a estar pendientes de pago, más un cargo por pago devuelto de {fee}.", "Seu banco devolveu seu pagamento bancário de {amount} referente a {month}. As faturas estão em aberto novamente, com uma taxa de pagamento devolvido de {fee}.", "Votre banque a retourné votre paiement bancaire de {amount} pour {month}. Les factures sont de nouveau ouvertes, avec des frais de paiement retourné de {fee}.", "Bank ou voye tounen peman labank {amount} ou te fè pou {month}. Fakti yo louvri ankò, plis yon frè peman retounen {fee}."],
  "Your electric reading for {month} was recorded: {usage} kWh used.": ["Se registró su lectura de electricidad de {month}: {usage} kWh consumidos.", "Sua leitura de energia de {month} foi registrada: {usage} kWh consumidos.", "Votre relevé d'électricité de {month} a été enregistré : {usage} kWh consommés.", "Lekti elektrisite ou pou {month} anrejistre: {usage} kWh konsome."],
  "Your electric reading for {month} was recorded: {usage} kWh used — {amount} added to your invoice.": ["Se registró su lectura de electricidad de {month}: {usage} kWh consumidos. Se agregaron {amount} a su factura.", "Sua leitura de energia de {month} foi registrada: {usage} kWh consumidos. Foram adicionados {amount} à sua fatura.", "Votre relevé d'électricité de {month} a été enregistré : {usage} kWh consommés. {amount} ont été ajoutés à votre facture.", "Lekti elektrisite ou pou {month} anrejistre: {usage} kWh konsome. Yo ajoute {amount} sou fakti ou."],
  "Your electric reading for {month} was corrected: {usage} kWh used.": ["Se corrigió su lectura de electricidad de {month}: {usage} kWh consumidos.", "Sua leitura de energia de {month} foi corrigida: {usage} kWh consumidos.", "Votre relevé d'électricité de {month} a été corrigé : {usage} kWh consommés.", "Lekti elektrisite ou pou {month} korije: {usage} kWh konsome."],
  "Your electric reading for {month} was corrected: {usage} kWh used — {amount} on your invoice.": ["Se corrigió su lectura de electricidad de {month}: {usage} kWh consumidos. Su factura ahora incluye {amount} de electricidad.", "Sua leitura de energia de {month} foi corrigida: {usage} kWh consumidos. Sua fatura agora inclui {amount} de energia.", "Votre relevé d'électricité de {month} a été corrigé : {usage} kWh consommés. Votre facture comprend maintenant {amount} d'électricité.", "Lekti elektrisite ou pou {month} korije: {usage} kWh konsome. Kounye a fakti ou gen {amount} pou elektrisite."],
  "A new charge was added to your invoice: {what} — {amount}.": ["Se agregó un nuevo cargo a su factura: {what} — {amount}.", "Uma nova cobrança foi adicionada à sua fatura: {what} — {amount}.", "De nouveaux frais ont été ajoutés à votre facture : {what} — {amount}.", "Yo ajoute yon nouvo frè sou fakti ou: {what} — {amount}."],
  "A maintenance charge was added to your invoice: {what} — {amount}.": ["Se agregó un cargo de mantenimiento a su factura: {what} — {amount}.", "Uma cobrança de manutenção foi adicionada à sua fatura: {what} — {amount}.", "Des frais d'entretien ont été ajoutés à votre facture : {what} — {amount}.", "Yo ajoute yon frè antretyen sou fakti ou: {what} — {amount}."],
  "Maintenance charge": ["Cargo de mantenimiento", "Cobrança de manutenção", "Frais d'entretien", "Frè antretyen"],
  'Your maintenance request status changed to "{status}".': ['El estado de su solicitud de mantenimiento cambió a "{status}".', 'O status da sua solicitação de manutenção mudou para "{status}".', "Le statut de votre demande d'entretien est maintenant « {status} ».", "Estati demann antretyen ou an chanje pou \"{status}\"."],
  "The office added an update to your maintenance request.": ["La oficina agregó una actualización a su solicitud de mantenimiento.", "O escritório adicionou uma atualização à sua solicitação de manutenção.", "Le bureau a ajouté une mise à jour à votre demande d'entretien.", "Biwo a ajoute yon nouvèl sou demann antretyen ou an."],
  '{park} sent you "{title}" to review and sign in your resident portal.': ['{park} le envió "{title}" para que lo revise y firme en su portal de residentes.', '{park} enviou "{title}" para você revisar e assinar no seu portal do morador.', "{park} vous a envoyé « {title} » à lire et à signer dans votre portail des résidents.", "{park} voye \"{title}\" ba ou pou w li epi siyen nan pòtay rezidan ou."],
  '{park} added "{title}" to your resident portal for you to review and sign.': ['{park} agregó "{title}" a su portal de residentes para que lo revise y firme.', '{park} adicionou "{title}" ao seu portal do morador para você revisar e assinar.', "{park} a ajouté « {title} » à votre portail des résidents pour que vous le lisiez et le signiez.", "{park} mete \"{title}\" nan pòtay rezidan ou pou w li epi siyen."],
  'New announcement: "{title}"': ['Nuevo anuncio: "{title}"', 'Novo aviso: "{title}"', "Nouvelle annonce : « {title} »", "Nouvo anons: \"{title}\""],
  "Background check for {name} (household occupant of {resident}): {result}.": ["Verificación de antecedentes de {name} (ocupante del hogar de {resident}): {result}.", "Verificação de antecedentes de {name} (morador da residência de {resident}): {result}.", "Vérification des antécédents de {name} (occupant du ménage de {resident}) : {result}.", "Verifikasyon dosye {name} (moun nan fwaye {resident}): {result}."],
  "maint:pending": ["Pendiente", "Pendente", "En attente", "An atant"],
  "maint:in_progress": ["En progreso", "Em andamento", "En cours", "An kou"],
  "maint:completed": ["Completada", "Concluída", "Terminée", "Fini"],
  "Resident Agreement — Returned Payments": ["Acuerdo de residente — Pagos devueltos", "Acordo do morador — Pagamentos devolvidos", "Entente de résident — Paiements retournés", "Akò rezidan — Peman ki retounen"],
  "bgc:passed": ["aprobada", "aprovada", "réussie", "pase"],
  "bgc:needs review": ["requiere revisión", "precisa de revisão", "à vérifier", "bezwen revize"],
  "bgc:canceled by Checkr (no result — contact Checkr support)": ["cancelada por Checkr (sin resultado; comuníquese con el soporte de Checkr)", "cancelada pela Checkr (sem resultado; fale com o suporte da Checkr)", "annulée par Checkr (aucun résultat — communiquez avec le soutien de Checkr)", "Checkr anile l (pa gen rezilta — kontakte sipò Checkr)"],
  "bgc:paused — Checkr needs more information from the applicant to continue (check that they received Checkr's email and completed the next step in their candidate portal)": ["en pausa: Checkr necesita más información de la persona para continuar (verifique que recibió el correo de Checkr y completó el siguiente paso en su portal de candidato)", "pausada: a Checkr precisa de mais informações da pessoa para continuar (confira se ela recebeu o e-mail da Checkr e concluiu a próxima etapa no portal do candidato)", "en pause — Checkr a besoin de plus de renseignements de la personne pour continuer (vérifiez qu'elle a reçu le courriel de Checkr et terminé la prochaine étape dans son portail de candidat)", "an poz — Checkr bezwen plis enfòmasyon nan men moun nan pou l kontinye (tcheke si li resevwa imel Checkr a epi li fè pwochen etap la nan pòtay kandida li)"],
  "bgc:invitation expired": ["la invitación venció", "o convite expirou", "l'invitation a expiré", "envitasyon an ekspire"],
  // ---- Phone push / SMS only (melyos-builder push/dispatch, send-invoice-sms) ----
  "You have a new update.": ["Tiene una nueva actualización.", "Você tem uma nova atualização.", "Vous avez une nouvelle mise à jour.", "Ou gen yon nouvèl."],
  "{park}: Your invoice for {month} — {amount} due {date}. Pay here: {url} Reply STOP to opt out.": ["{park}: Su factura de {month} — {amount}, vence el {date}. Pague aquí: {url} Responda STOP para no recibir más mensajes.", "{park}: Sua fatura de {month} — {amount}, vencimento em {date}. Pague aqui: {url} Responda STOP para não receber mais mensagens.", "{park} : Votre facture de {month} — {amount}, échéance le {date}. Payez ici : {url} Répondez STOP pour ne plus recevoir de messages.", "{park}: Fakti pou {month} — {amount}, dat limit {date}. Peye isit la: {url} Reponn STOP pou w pa resevwa mesaj ankò."],
};

/** Plain lookup in NOTIF_DICT (server texts that aren't bell templates, e.g. the invoice SMS). */
export function notifText(lang: unknown, key: string, vars?: NotifVars): string {
  try {
    const l: NotifLang = isNotifLang(lang) ? lang : "en";
    const out = tr(NOTIF_DICT, l, key, vars);
    return l === "fr" ? frElide(out) : out;
  } catch {
    return fillVars(key, vars);
  }
}
