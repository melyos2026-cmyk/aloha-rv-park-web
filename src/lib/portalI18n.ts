// Oct 29 (per the owner — some residents speak only English, only Spanish or only Portuguese):
// the resident portal's language layer. English / Spanish (Latin American, "usted") / Brazilian
// Portuguese / French (Canada, "vous" — Quebec snowbirds) / Haitian Creole (Kreyòl ayisyen, standard
// orthography) — the last two added Oct 29.
//
// · Keys are the English text itself, so English never changes and anything missing from the
//   es/pt/fr/ht dictionaries simply shows in English (nothing breaks).
// · `{name}` placeholders are filled from `vars`.
// · The chosen language lives in localStorage ("portal_lang") and, when the column exists, on
//   resident_accounts.portal_language (POST /api/portal/language — the portal works the same
//   without it). Default: the browser's language when it is Spanish, Portuguese, French or
//   Haitian Creole, else English.
// · No provider needed: one small store shared by every portal page and component (the login page
//   lives outside /residents). `usePortalLang()` re-renders on change; plain `ptr()` is for code
//   outside React (e.g. the portal dialogs).
// · NOT translated on purpose: signed / hashed legal text (Resident Agreement & lease bodies, the
//   autopay / ACH / SMS authorizations that are stored as proof) and anything the park wrote
//   (rules, announcements, office notes, listing text). Money is always USD.
import { createElement, Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";
// Oct 29: the bell / push templates + date labels live in the pure ./notificationI18n (shared with the
// server push in melyos-builder). Re-exported here so existing imports keep working.
import { NOTIF_DICT, NOTIF_LOCALES, formatDate, frElide, intlDateText, langIndex, localizeDateLabel, translateNotificationTemplate, type NotifDict } from "./notificationI18n";
export { formatDate, localizeDateLabel };
import { translateRecHallNotice } from "./recHallI18n";

export type PortalLang = "en" | "es" | "pt" | "fr" | "ht";
export const PORTAL_LANGS: { code: PortalLang; label: string; name: string }[] = [
  { code: "en", label: "EN", name: "English" },
  { code: "es", label: "ES", name: "Español" },
  { code: "pt", label: "PT", name: "Português" },
  { code: "fr", label: "FR", name: "Français" },
  { code: "ht", label: "HT", name: "Kreyòl ayisyen" },
];
const STORAGE_KEY = "portal_lang";
const LOCALES: Record<PortalLang, string> = NOTIF_LOCALES;

const isLang = (x: unknown): x is PortalLang => x === "en" || x === "es" || x === "pt" || x === "fr" || x === "ht";

let current: PortalLang | null = null;
const listeners = new Set<() => void>();

function readStored(): PortalLang | null {
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    return isLang(s) ? s : null;
  } catch {
    return null;
  }
}

function detect(): PortalLang {
  const stored = readStored();
  if (stored) return stored;
  try {
    const first = String((navigator.languages && navigator.languages[0]) || navigator.language || "").toLowerCase();
    if (first.startsWith("es")) return "es";
    if (first.startsWith("pt")) return "pt";
    if (first.startsWith("fr")) return "fr";
    if (first.startsWith("ht")) return "ht";
  } catch {}
  return "en";
}

export function getPortalLang(): PortalLang {
  if (typeof window === "undefined") return "en";
  if (current === null) current = detect();
  return current;
}

function emit() {
  try { document.documentElement.lang = getPortalLang(); } catch {}
  listeners.forEach((l) => l());
}

/** Change the language (saved in this browser; also on the resident's account when residentId is given). */
export function setPortalLang(lang: PortalLang, residentId?: string | null) {
  if (!isLang(lang)) return;
  current = lang;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch {}
  emit();
  if (residentId) {
    fetch("/api/portal/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ residentId, lang }),
      keepalive: true,
    }).catch(() => {});
  }
}

/** The language saved on the resident's account (if any) — used only when this browser has no choice yet. */
// Oct 29: also the other way round — when the account's column exists but is empty (null) and this
// browser already chose another language than English, save that choice once so phone alerts come in it too.
export function adoptSavedPortalLang(saved: unknown, residentId?: string | null) {
  if (typeof window === "undefined") return;
  if (saved === null && residentId) {
    const stored = readStored();
    if (stored && stored !== "en") {
      fetch("/api/portal/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId, lang: stored }),
        keepalive: true,
      }).catch(() => {});
    }
    return;
  }
  if (!isLang(saved) || readStored()) return;
  if (getPortalLang() === saved) return;
  current = saved;
  try { window.localStorage.setItem(STORAGE_KEY, saved); } catch {}
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && isLang(e.newValue) && e.newValue !== current) { current = e.newValue; emit(); }
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}

// ---------------------------------------------------------------------------------------------
// Core helpers (pure — take the language explicitly)
// ---------------------------------------------------------------------------------------------
type Vars = Record<string, string | number | null | undefined>;

function fill(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export function translate(lang: PortalLang, key: string, vars?: Vars): string {
  if (lang === "en") return fill(key, vars);
  const row = DICT[key];
  const out = fill(row?.[langIndex(lang)] ?? key, vars);
  return lang === "fr" ? frElide(out) : out;
}

/** A status value from the database ("Paid", "Open"…) — "status:" entries first, then plain ones. */
export function translateStatus(lang: PortalLang, value: string | null | undefined): string {
  const v = String(value ?? "");
  if (lang === "en" || !v) return v;
  const row = DICT["status:" + v] || DICT[v];
  return row?.[langIndex(lang)] ?? v;
}

export function translatePlural(lang: PortalLang, n: number, one: string, other: string, vars?: Vars) {
  return translate(lang, n === 1 ? one : other, { n, ...(vars || {}) });
}

export function formatMoney(lang: PortalLang, n: number | string | null | undefined) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(LOCALES[lang], { style: "currency", currency: "USD" }).format(Number.isFinite(v) ? v : 0);
  } catch {
    return `$${(Number.isFinite(v) ? v : 0).toFixed(2)}`;
  }
}

export function formatDateTime(lang: PortalLang, value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  try { return intlDateText(lang, d, opts, "datetime"); } catch { return d.toLocaleString("en-US", opts); }
}

/** The company's returned-payment fee rule (src/lib/returnedFeeRules.ts returnedFeePhrase) in the resident's language. */
export function translateReturnFeePhrase(lang: PortalLang, phrase: string | null | undefined): string {
  const p = phrase || "a returned-payment fee of $29–$35 applies (the returned-payment processing cost plus a service charge allowed by Florida law)";
  if (lang === "en") return p;
  if (/^a returned-payment fee of \$29–\$35 applies \(the returned-payment processing cost plus a service charge allowed by Florida law\)$/.test(p)) {
    return translate(lang, "a returned-payment fee of $29–$35 applies (the returned-payment processing cost plus a service charge allowed by Florida law)");
  }
  let m = /^a returned-payment fee of (\$[\d.,]+) or ([\d.]+)% of the invoice amount, whichever is greater(?:, up to (\$[\d.,]+))?, applies$/.exec(p);
  if (m) {
    return m[3]
      ? translate(lang, "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, up to {cap}, applies", { flat: m[1], pct: m[2], cap: m[3] })
      : translate(lang, "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, applies", { flat: m[1], pct: m[2] });
  }
  m = /^a returned-payment fee of (\$[\d.,]+) applies$/.exec(p);
  if (m) return translate(lang, "a returned-payment fee of {flat} applies", { flat: m[1] });
  return p;
}

/** Same sentence as returnedFeeSentence() in src/lib/autopayTerms.ts, in the resident's language. */
export function translateReturnedFeeSentence(lang: PortalLang, phrase?: string | null) {
  return translate(lang, "If your bank returns a payment, {phrase}.", { phrase: translateReturnFeePhrase(lang, phrase) });
}

/**
 * Server messages are in English. The common ones are translated here (exact text, or a known
 * pattern); anything else is shown as the server sent it.
 */
export function translateServerMessage(lang: PortalLang, msg: string | null | undefined): string {
  if (!msg) return "";
  const s = String(msg);
  if (lang === "en") return s;
  if (DICT[s]) return translate(lang, s);
  let m: RegExpExecArray | null;
  if ((m = /^Please pay your (.+) invoice \((\$[\d.,]+)\) before accessing your resident portal\.$/.exec(s)))
    return translate(lang, "Please pay your {month} invoice ({amount}) before accessing your resident portal.", { month: localizeDateLabel(lang, m[1]), amount: m[2] });
  if ((m = /^This invoice can be paid starting (.+)\.$/.exec(s)))
    return translate(lang, "This invoice can be paid starting {date}.", { date: localizeDateLabel(lang, m[1]) });
  if ((m = /^Your invoice is being prepared — it will be available to pay on (.+)\.$/.exec(s)))
    return translate(lang, "Your invoice is being prepared — it will be available to pay on {date}.", { date: localizeDateLabel(lang, m[1]) });
  if ((m = /^Available to pay on (.+)\.$/.exec(s)))
    return translate(lang, "Available to pay on {date}.", { date: localizeDateLabel(lang, m[1]) });
  if ((m = /^Bank payment is available on balances of (\$[\d.,]+) or more\. Please pay by card\.$/.exec(s)))
    return translate(lang, "Bank payment is available on balances of {amount} or more. Please pay by card.", { amount: m[1] });
  if ((m = /^Your electric reading is added around the (\d+)(?:st|nd|rd|th) — you can pay as soon as it's on your invoice\.$/.exec(s)))
    return translate(lang, "Your electric reading is added around day {day} of the month — you can pay as soon as it's on your invoice.", { day: m[1] });
  if ((m = /^Could not upload file: (.*)$/.exec(s))) return translate(lang, "Could not upload file: {detail}", { detail: m[1] });
  const n = translateNotificationMessage(lang, s);
  if (n !== null) return n;
  return s;
}

/**
 * Oct 29 (per Mely): the resident's bell / Messages rows (English in the database) in this language.
 * The patterns live in ./notificationI18n.ts (also used by the server push); the full UI dictionary is
 * passed so charge names / document titles translate too. null = not a known template.
 */
export function translateNotificationMessage(lang: PortalLang, s: string): string | null {
  if (lang !== "en") { const rh = translateRecHallNotice(lang, s); if (rh !== null) return rh; } // Oct 29: Rec Hall requests
  return translateNotificationTemplate(lang, s, DICT);
}

/**
 * Translated sentences that need bold words use <b>…</b>; `{name}` slots can hold React nodes
 * (e.g. an icon). Everything else is plain text (never HTML).
 */
export function richText(s: string, slots?: Record<string, ReactNode>): ReactNode {
  const parts = s.split(/(<b>[\s\S]*?<\/b>|\{\w+\})/g).filter((x) => x !== "");
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const b = /^<b>([\s\S]*)<\/b>$/.exec(part);
      if (b) return createElement("strong", { key: i }, b[1]);
      const slot = /^\{(\w+)\}$/.exec(part);
      if (slot && slots && slot[1] in slots) return createElement(Fragment, { key: i }, slots[slot[1]]);
      return createElement(Fragment, { key: i }, part);
    })
  );
}

// ---------------------------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------------------------
export type PortalI18n = ReturnType<typeof makeApi>;

function makeApi(lang: PortalLang) {
  return {
    lang,
    locale: LOCALES[lang],
    setLang: setPortalLang,
    /** Translate UI text (the English text is the key). */
    t: (key: string, vars?: Vars) => translate(lang, key, vars),
    /** Status values from the database ("Paid", "Open", "Active"…). */
    st: (value: string | null | undefined) => translateStatus(lang, value),
    /** Plural: picks `one` when n === 1; `{n}` is filled in. */
    tp: (n: number, one: string, other: string, vars?: Vars) => translatePlural(lang, n, one, other, vars),
    money: (n: number | string | null | undefined) => formatMoney(lang, n),
    date: (v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => formatDate(lang, v, opts),
    dateTime: (v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) => formatDateTime(lang, v, opts),
    /** Server-built English date labels ("November 1, 2026", "July 2026") in this language. */
    dateLabel: (label: string | null | undefined, long = true) => localizeDateLabel(lang, label, long),
    /** Server messages (errors etc.) — known ones translated, others as sent. */
    err: (msg: string | null | undefined) => translateServerMessage(lang, msg),
    returnedFeeSentence: (phrase?: string | null) => translateReturnedFeeSentence(lang, phrase),
    /** Translate, then render <b>…</b> as bold and {slot} as the given React nodes. */
    rich: (key: string, vars?: Vars, slots?: Record<string, ReactNode>) => richText(translate(lang, key, vars), slots),
  };
}

/** Current portal language + helpers. Renders English on the server and on the first client pass. */
export function usePortalLang(): PortalI18n {
  const lang = useSyncExternalStore(subscribe, getPortalLang, () => "en" as PortalLang);
  return useMemo(() => makeApi(lang), [lang]);
}

/** Outside React (dialogs, one-off messages): translate with the current language. */
export function ptr(key: string, vars?: Vars) {
  return translate(getPortalLang(), key, vars);
}

// ---------------------------------------------------------------------------------------------
// Dictionary: English → [Spanish, Brazilian Portuguese, French (Canada), Haitian Creole]
// ---------------------------------------------------------------------------------------------
const DICT: NotifDict = {
  ...NOTIF_DICT,
  // ---- Shared / general ----
  "Resident Portal": ["Portal de residentes", "Portal do morador", "Portail des résidents", "Pòtay rezidan"],
  "Language": ["Idioma", "Idioma", "Langue", "Lang"],
  "Loading...": ["Cargando...", "Carregando...", "Chargement...", "Ap chaje..."],
  "Back to Dashboard": ["Volver al panel", "Voltar ao painel", "Retour au tableau de bord", "Retounen nan tablo a"],
  "Back": ["Volver", "Voltar", "Retour", "Retounen"],
  "Save": ["Guardar", "Salvar", "Enregistrer", "Anrejistre"],
  "Saving...": ["Guardando...", "Salvando...", "Enregistrement...", "Ap anrejistre..."],
  "Cancel": ["Cancelar", "Cancelar", "Annuler", "Anile"],
  "Edit": ["Editar", "Editar", "Modifier", "Modifye"],
  "Remove": ["Quitar", "Remover", "Retirer", "Retire"],
  "Delete": ["Eliminar", "Excluir", "Supprimer", "Efase"],
  "Close": ["Cerrar", "Fechar", "Fermer", "Fèmen"],
  "Dismiss": ["Descartar", "Dispensar", "Ignorer", "Fèmen"],
  "Yes": ["Sí", "Sim", "Oui", "Wi"],
  "No": ["No", "Não", "Non", "Non"],
  "OK": ["Aceptar", "OK", "OK", "Dakò"],
  "Please confirm": ["Confirme, por favor", "Confirme, por favor", "Veuillez confirmer", "Tanpri konfime"],
  "Notice": ["Aviso", "Aviso", "Avis", "Avi"],
  "+ Add": ["+ Agregar", "+ Adicionar", "+ Ajouter", "+ Ajoute"],
  "Sign Out": ["Cerrar sesión", "Sair", "Se déconnecter", "Dekonekte"],
  "Please log in again.": ["Inicie sesión de nuevo, por favor.", "Entre novamente, por favor.", "Veuillez vous reconnecter.", "Tanpri konekte ankò."],
  "Something went wrong. Please try again.": ["Algo salió mal. Inténtelo de nuevo.", "Algo deu errado. Tente novamente.", "Une erreur est survenue. Veuillez réessayer.", "Gen yon bagay ki pa mache. Tanpri eseye ankò."],
  "Something went wrong.": ["Algo salió mal.", "Algo deu errado.", "Une erreur est survenue.", "Gen yon bagay ki pa mache."],
  "Could not start payment.": ["No se pudo iniciar el pago.", "Não foi possível iniciar o pagamento.", "Impossible de lancer le paiement.", "Nou pa t kapab kòmanse peman an."],
  "Could not start payment. Please try again.": ["No se pudo iniciar el pago. Inténtelo de nuevo.", "Não foi possível iniciar o pagamento. Tente novamente.", "Impossible de lancer le paiement. Veuillez réessayer.", "Nou pa t kapab kòmanse peman an. Tanpri eseye ankò."],
  "Redirecting to payment...": ["Abriendo la página de pago...", "Abrindo a página de pagamento...", "Ouverture de la page de paiement...", "N ap louvri paj peman an..."],
  "Pay Now": ["Pagar ahora", "Pagar agora", "Payer maintenant", "Peye kounye a"],
  "Lot {name}": ["Lote {name}", "Lote {name}", "Terrain {name}", "Espas {name}"],
  "Charge": ["Cargo", "Cobrança", "Frais", "Frè"],
  "Card": ["Tarjeta", "Cartão", "Carte", "Kat"],
  "The park office is notified whenever you update this information.": ["La oficina del parque recibe un aviso cada vez que usted actualiza esta información.", "O escritório do parque é avisado sempre que você atualiza estas informações.", "Le bureau du parc est avisé chaque fois que vous mettez à jour ces renseignements.", "Biwo pak la resevwa yon avi chak fwa ou mete enfòmasyon sa yo ajou."],
  "This document is in English; it is the version you sign.": ["Este documento está en inglés; es la versión que usted firma.", "Este documento está em inglês; é a versão que você assina.", "Ce document est en anglais; c'est la version que vous signez.", "Dokiman sa a an anglè; se vèsyon sa a ou siyen."],
  "These documents are in English; they are the versions you signed.": ["Estos documentos están en inglés; son las versiones que usted firmó.", "Estes documentos estão em inglês; são as versões que você assinou.", "Ces documents sont en anglais; ce sont les versions que vous avez signées.", "Dokiman sa yo an anglè; se vèsyon sa yo ou te siyen."],
  "This authorization is in English; it is the version you agree to.": ["Esta autorización está en inglés; es la versión que usted acepta.", "Esta autorização está em inglês; é a versão que você aceita.", "Cette autorisation est en anglais; c'est la version que vous acceptez.", "Otorizasyon sa a an anglè; se vèsyon sa a ou aksepte."],
  "This consent is in English; it is the version you agree to.": ["Este consentimiento está en inglés; es la versión que usted acepta.", "Este consentimento está em inglês; é a versão que você aceita.", "Ce consentement est en anglais; c'est la version que vous acceptez.", "Konsantman sa a an anglè; se vèsyon sa a ou aksepte."],
  "Written by the park": ["Escrito por el parque", "Escrito pelo parque", "Rédigé par le parc", "Pak la ki ekri l"],
  "Uploading...": ["Subiendo...", "Enviando...", "Téléversement...", "Ap telechaje..."],

  // (Resident bell / Messages templates: NOTIF_DICT in ./notificationI18n.ts, spread in above.)
  // ---- Statuses from the database ("status:" + value; see st()) ----
  "status:Paid": ["Pagada", "Paga", "Payée", "Peye"],
  "status:Pending": ["Pendiente", "Pendente", "En attente", "An atant"],
  "status:Processing": ["En proceso", "Em processamento", "En traitement", "Ap trete"],
  "Processing (bank)": ["En proceso (banco)", "Em processamento (banco)", "En traitement (banque)", "Ap trete (bank)"],
  "status:Overdue": ["Vencida", "Vencida", "En retard", "An reta"],
  "status:Void": ["Anulada", "Anulada", "Annulée", "Anile"],
  "status:Cancelled": ["Cancelada", "Cancelada", "Annulée", "Anile"],
  "status:Refunded": ["Reembolsada", "Reembolsada", "Remboursée", "Ranbouse"],
  "status:Active": ["Activo", "Ativo", "Actif", "Aktif"],
  "status:Ended": ["Terminado", "Encerrado", "Terminé", "Fini"],
  "status:Expired": ["Vencido", "Expirado", "Expiré", "Ekspire"],
  "status:Terminated": ["Terminado", "Rescindido", "Résilié", "Revoke"],
  "status:Draft": ["Borrador", "Rascunho", "Brouillon", "Bouyon"],
  "status:Open": ["Abierta", "Aberta", "Ouverte", "Louvri"],
  "status:In Progress": ["En progreso", "Em andamento", "En cours", "An kou"],
  "status:Completed": ["Completada", "Concluída", "Terminée", "Fini"],
  "status:Closed": ["Cerrada", "Fechada", "Fermée", "Fèmen"],
  "status:Resolved": ["Resuelta", "Resolvida", "Résolue", "Rezoud"],
  "Low": ["Baja", "Baixa", "Basse", "Ba"],
  "Normal": ["Normal", "Normal", "Normale", "Nòmal"],
  "High": ["Alta", "Alta", "Haute", "Wo"],
  "Urgent": ["Urgente", "Urgente", "Urgente", "Ijan"],
  "Passed": ["Aprobada", "Aprovada", "Réussie", "Pase"],
  "Needs Review": ["En revisión", "Em análise", "À vérifier", "Pou revize"],
  "In progress": ["En progreso", "Em andamento", "En cours", "An kou"],

  // ---- Language switcher ----
  "Choose your language": ["Elija su idioma", "Escolha seu idioma", "Choisissez votre langue", "Chwazi lang ou"],

  // ---- Dashboard: navigation ----
  "Home": ["Inicio", "Início", "Accueil", "Akèy"],
  "Payments": ["Pagos", "Pagamentos", "Paiements", "Peman"],
  "Pay": ["Pagar", "Pagar", "Payer", "Peye"],
  "My lot & home": ["Mi lote y vivienda", "Meu lote e casa", "Mon terrain et ma maison", "Espas mwen ak kay mwen"],
  "My lot": ["Mi lote", "Meu lote", "Mon terrain", "Espas mwen"],
  "Household": ["Hogar", "Moradores", "Ménage", "Fwaye"],
  "Requests": ["Solicitudes", "Solicitações", "Demandes", "Demann"],
  "Messages": ["Mensajes", "Mensagens", "Messages", "Mesaj"],
  "Park info": ["Info del parque", "Info do parque", "Infos du parc", "Enfò sou pak la"],
  "Profile & more": ["Perfil y más", "Perfil e mais", "Profil et plus", "Pwofil ak plis"],
  "More": ["Más", "Mais", "Plus", "Plis"],
  "Autopay": ["Pago automático", "Pagamento automático", "Paiement automatique", "Peman otomatik"],
  "Charges & invoices": ["Cargos y facturas", "Cobranças e faturas", "Frais et factures", "Frè ak fakti"],
  "Electric usage": ["Consumo eléctrico", "Consumo de energia", "Consommation d'électricité", "Konsomasyon elektrisite"],
  "Payment history": ["Historial de pagos", "Histórico de pagamentos", "Historique des paiements", "Istorik peman"],
  "Electric history": ["Historial eléctrico", "Histórico de energia", "Historique d'électricité", "Istorik elektrisite"],
  "Home info": ["Datos de la vivienda", "Dados da casa", "Infos sur la maison", "Enfò sou kay la"],
  "Parking & pets": ["Estacionamiento y mascotas", "Estacionamento e animais", "Stationnement et animaux", "Pakin ak bèt"],
  "Rent-to-own": ["Alquiler con opción a compra", "Aluguel com opção de compra", "Location avec option d'achat", "Lwaye pou achte"],
  "Documents": ["Documentos", "Documentos", "Documents", "Dokiman"],
  "Moving out": ["Mudanza", "Mudança", "Déménagement", "Demenajman"],
  "Occupants": ["Ocupantes", "Ocupantes", "Occupants", "Moun k ap viv avè w"],
  "Visitors": ["Visitantes", "Visitantes", "Visiteurs", "Vizitè"],
  "Vehicles": ["Vehículos", "Veículos", "Véhicules", "Machin"],
  "Golf carts": ["Carritos de golf", "Carrinhos de golfe", "Voiturettes de golf", "Kabwèt gòlf"],
  "Background checks": ["Verificaciones de antecedentes", "Verificações de antecedentes", "Vérifications des antécédents", "Verifikasyon dosye"],
  "Maintenance": ["Mantenimiento", "Manutenção", "Entretien", "Antretyen"],
  "Propane": ["Propano", "Propano", "Propane", "Pwopàn"],
  "Notifications": ["Notificaciones", "Notificações", "Notifications", "Notifikasyon"],
  "Announcements": ["Anuncios", "Avisos", "Annonces", "Anons"],
  "Call 9-1-1 first": ["Llame primero al 9-1-1", "Ligue primeiro para o 9-1-1", "Composez d'abord le 9-1-1", "Rele 9-1-1 anvan"],
  "Park emergency line": ["Línea de emergencia del parque", "Linha de emergência do parque", "Ligne d'urgence du parc", "Liy ijans pak la"],
  "Office hours": ["Horario de oficina", "Horário do escritório", "Heures du bureau", "Lè biwo a ouvè"],
  "Park rules": ["Reglas del parque", "Regras do parque", "Règlements du parc", "Règleman pak la"],
  "My information": ["Mi información", "Minhas informações", "Mes renseignements", "Enfòmasyon mwen"],
  "Emergency contact": ["Contacto de emergencia", "Contato de emergência", "Contact d'urgence", "Kontak an ka ijans"],
  "Marketplace": ["Marketplace", "Marketplace", "Marketplace", "Marketplace"],
  "In this section": ["En esta sección", "Nesta seção", "Dans cette section", "Nan seksyon sa a"],

  // ---- Dashboard: header / home ----
  "Welcome, {name}": ["Bienvenido(a), {name}", "Bem-vindo(a), {name}", "Bienvenue, {name}", "Byenveni, {name}"],
  "Nothing yet.": ["Todavía no hay nada.", "Nada por enquanto.", "Rien pour l'instant.", "Poko gen anyen."],
  "Resident not found.": ["No se encontró al residente.", "Morador não encontrado.", "Résident introuvable.", "Nou pa jwenn rezidan an."],
  "Failed to load profile.": ["No se pudo cargar el perfil.", "Não foi possível carregar o perfil.", "Impossible de charger le profil.", "Nou pa t kapab chaje pwofil la."],
  "To do here": ["Pendiente aquí", "Pendências aqui", "À faire ici", "Sa pou fè isit la"],
  "The red number goes away as soon as each item is done.": ["El número rojo desaparece en cuanto cada cosa queda hecha.", "O número vermelho some assim que cada item é resolvido.", "Le chiffre rouge disparaît dès que chaque élément est réglé.", "Chif wouj la ap disparèt kou chak bagay fin fèt."],
  "Needs your attention": ["Requiere su atención", "Precisa da sua atenção", "Demande votre attention", "Bezwen atansyon w"],
  "✓ You're all set. Nothing needs your attention right now.": ["✓ Todo está al día. No hay nada pendiente por ahora.", "✓ Tudo em dia. Nada precisa da sua atenção agora.", "✓ Tout est en ordre. Rien ne demande votre attention pour l'instant.", "✓ Tout bagay anfòm. Pa gen anyen ki bezwen atansyon w kounye a."],
  "Outstanding Balance": ["Saldo pendiente", "Saldo em aberto", "Solde à payer", "Balans pou peye"],
  "{amount} overdue": ["{amount} vencido", "{amount} vencido", "{amount} en retard", "{amount} an reta"],
  "Next Payment (Due Date):": ["Próximo pago (fecha de vencimiento):", "Próximo pagamento (vencimento):", "Prochain paiement (date d'échéance) :", "Pwochen peman (dat limit):"],
  "Grace period: {n} day, until the end of {date}. A late fee applies after that date.": ["Período de gracia: {n} día, hasta el final del {date}. Después de esa fecha se cobra un recargo por pago tardío.", "Período de carência: {n} dia, até o fim de {date}. Depois dessa data é cobrada multa por atraso.", "Délai de grâce : {n} jour, jusqu'à la fin du {date}. Des frais de retard s'appliquent après cette date.", "Delè gras: {n} jou, jiska fen jounen {date}. Gen frè reta apre dat sa a."],
  "Grace period: {n} days, until the end of {date}. A late fee applies after that date.": ["Período de gracia: {n} días, hasta el final del {date}. Después de esa fecha se cobra un recargo por pago tardío.", "Período de carência: {n} dias, até o fim de {date}. Depois dessa data é cobrada multa por atraso.", "Délai de grâce : {n} jours, jusqu'à la fin du {date}. Des frais de retard s'appliquent après cette date.", "Delè gras: {n} jou, jiska fen jounen {date}. Gen frè reta apre dat sa a."],
  "No grace period: a late fee applies after the due date.": ["Sin período de gracia: después de la fecha de vencimiento se cobra un recargo por pago tardío.", "Sem período de carência: depois do vencimento é cobrada multa por atraso.", "Aucun délai de grâce : des frais de retard s'appliquent après la date d'échéance.", "Pa gen delè gras: gen frè reta apre dat limit la."],
  "{amount} bank payment processing · clears in 3–5 business days": ["{amount} en pago bancario en proceso · se acredita en 3 a 5 días hábiles", "{amount} em pagamento bancário em processamento · compensa em 3 a 5 dias úteis", "Paiement bancaire de {amount} en traitement · réglé d'ici 3 à 5 jours ouvrables", "Peman labank {amount} ap trete · l ap pase nan 3 a 5 jou ouvrab"],
  "Next month's invoice is ready ({amount}) —": ["La factura del próximo mes ya está lista ({amount}) —", "A fatura do próximo mês já está pronta ({amount}) —", "La facture du mois prochain est prête ({amount}) —", "Fakti mwa pwochen an pare ({amount}) —"],
  "pay ahead (optional)": ["pagar por adelantado (opcional)", "pagar adiantado (opcional)", "payer d'avance (facultatif)", "peye davans (si ou vle)"],
  "See charges": ["Ver cargos", "Ver cobranças", "Voir les frais", "Gade frè yo"],
  "View all": ["Ver todo", "Ver tudo", "Tout voir", "Gade tout"],
  "Details": ["Detalles", "Detalhes", "Détails", "Detay"],
  "Open": ["Abrir", "Abrir", "Ouvrir", "Louvri"],
  "View": ["Ver", "Ver", "Voir", "Gade"],
  "{n} overdue invoice": ["{n} factura vencida", "{n} fatura vencida", "{n} facture en retard", "{n} fakti an reta"],
  "{n} overdue invoices": ["{n} facturas vencidas", "{n} faturas vencidas", "{n} factures en retard", "{n} fakti an reta"],
  "{amount} past due": ["{amount} vencido", "{amount} vencido", "{amount} en souffrance", "{amount} an reta"],
  "Balance due: {amount}": ["Saldo a pagar: {amount}", "Saldo a pagar: {amount}", "Solde à payer : {amount}", "Balans pou peye: {amount}"],
  "Next payment due {date}": ["Próximo pago vence el {date}", "Próximo pagamento vence em {date}", "Prochain paiement dû le {date}", "Pwochen peman an dwe fèt {date}"],
  "{n} invoice to pay": ["{n} factura por pagar", "{n} fatura a pagar", "{n} facture à payer", "{n} fakti pou peye"],
  "{n} invoices to pay": ["{n} facturas por pagar", "{n} faturas a pagar", "{n} factures à payer", "{n} fakti pou peye"],
  "Autopay could not take the bank payment": ["El pago automático no pudo cobrar del banco", "O pagamento automático não conseguiu debitar do banco", "Le paiement automatique n'a pas pu prélever le paiement bancaire", "Peman otomatik la pa t kapab retire peman an nan bank lan"],
  "Autopay could not charge your card": ["El pago automático no pudo cobrar a su tarjeta", "O pagamento automático não conseguiu cobrar no seu cartão", "Le paiement automatique n'a pas pu débiter votre carte", "Peman otomatik la pa t kapab chaje kat ou"],
  "Pay by hand or set up autopay again": ["Pague usted mismo o vuelva a configurar el pago automático", "Pague manualmente ou configure o pagamento automático de novo", "Payez manuellement ou réactivez le paiement automatique", "Peye ak men w oswa mete peman otomatik la ankò"],
  "Update your card or pay by hand": ["Actualice su tarjeta o pague usted mismo", "Atualize seu cartão ou pague manualmente", "Mettez votre carte à jour ou payez manuellement", "Mete kat ou ajou oswa peye ak men w"],
  "Background check needed": ["Se necesita verificación de antecedentes", "Verificação de antecedentes necessária", "Vérification des antécédents requise", "Bezwen verifikasyon dosye"],
  "{name} — ID received, start the check": ["{name} — identificación recibida, inicie la verificación", "{name} — documento recebido, inicie a verificação", "{name} — pièce d'identité reçue, lancez la vérification", "{name} — nou resevwa ID a, kòmanse verifikasyon an"],
  "Photo ID needed": ["Se necesita identificación con foto", "Documento com foto necessário", "Pièce d'identité avec photo requise", "Bezwen yon ID ak foto"],
  "{name} is 18+ — upload an ID, then the background check": ["{name} tiene 18 años o más — suba una identificación y luego haga la verificación de antecedentes", "{name} tem 18 anos ou mais — envie um documento e depois faça a verificação de antecedentes", "{name} a 18 ans ou plus — téléversez une pièce d'identité, puis faites la vérification des antécédents", "{name} gen 18 an oswa plis — voye yon ID, apre sa fè verifikasyon dosye a"],
  "{n} household occupant": ["{n} ocupante del hogar", "{n} morador", "{n} occupant du ménage", "{n} moun nan fwaye a"],
  "{n} household occupants": ["{n} ocupantes del hogar", "{n} moradores", "{n} occupants du ménage", "{n} moun nan fwaye a"],
  "Please sign: {title}": ["Por favor firme: {title}", "Por favor assine: {title}", "Veuillez signer : {title}", "Tanpri siyen: {title}"],
  "Review and sign it online — it takes a minute": ["Revíselo y fírmelo en línea — toma un minuto", "Revise e assine on-line — leva um minuto", "Lisez-le et signez-le en ligne — ça prend une minute", "Li l epi siyen l sou entènèt — sa pran yon minit"],
  "Sign your Bill of Sale": ["Firme su contrato de compraventa", "Assine seu contrato de compra e venda", "Signez votre acte de vente", "Siyen papye vant ou (Bill of Sale)"],
  "Your Rent-to-Own home is paid off": ["Su vivienda de alquiler con opción a compra está pagada", "Sua casa do aluguel com opção de compra está quitada", "Votre maison en location avec option d'achat est payée", "Kay lwaye pou achte ou a fin peye"],
  "Add your home/unit info": ["Agregue los datos de su vivienda/unidad", "Adicione os dados da sua casa/unidade", "Ajoutez les infos de votre maison/unité", "Ajoute enfò sou kay/inite ou"],
  "Make, model and VIN / Tag #": ["Marca, modelo y VIN / número de placa", "Marca, modelo e VIN / número da placa", "Marque, modèle et NIV / n° de plaque", "Mak, modèl ak VIN / nimewo plak"],
  "Add an emergency contact": ["Agregue un contacto de emergencia", "Adicione um contato de emergência", "Ajoutez un contact d'urgence", "Ajoute yon kontak an ka ijans"],
  "Pet shots records not provided": ["Faltan los registros de vacunas de la mascota", "Carteira de vacinação do animal não enviada", "Carnet de vaccination de l'animal non fourni", "Ou poko bay kanè vaksen bèt la"],
  "Pet": ["Mascota", "Animal", "Animal", "Bèt"],
  "{n} propane order ready for pickup": ["{n} pedido de propano listo para recoger", "{n} pedido de propano pronto para retirada", "{n} commande de propane prête à récupérer", "{n} kòmand pwopàn pare pou w vin pran"],
  "{n} propane orders ready for pickup": ["{n} pedidos de propano listos para recoger", "{n} pedidos de propano prontos para retirada", "{n} commandes de propane prêtes à récupérer", "{n} kòmand pwopàn pare pou w vin pran"],
  "Show the QR code to staff": ["Muestre el código QR al personal", "Mostre o código QR à equipe", "Montrez le code QR au personnel", "Montre anplwaye a kòd QR la"],
  "{n} new notification": ["{n} notificación nueva", "{n} notificação nova", "{n} nouvelle notification", "{n} nouvo notifikasyon"],
  "{n} new notifications": ["{n} notificaciones nuevas", "{n} notificações novas", "{n} nouvelles notifications", "{n} nouvo notifikasyon"],
  "{amount} due · {n} invoice": ["{amount} a pagar · {n} factura", "{amount} a pagar · {n} fatura", "{amount} à payer · {n} facture", "{amount} pou peye · {n} fakti"],
  "{amount} due · {n} invoices": ["{amount} a pagar · {n} facturas", "{amount} a pagar · {n} faturas", "{amount} à payer · {n} factures", "{amount} pou peye · {n} fakti"],
  "All paid up": ["Todo pagado", "Tudo pago", "Tout est payé", "Tout peye"],
  "Next payment {date}": ["Próximo pago: {date}", "Próximo pagamento: {date}", "Prochain paiement : {date}", "Pwochen peman: {date}"],
  "Autopay on": ["Pago automático activado", "Pagamento automático ativado", "Paiement automatique activé", "Peman otomatik limen"],
  "Autopay off": ["Pago automático desactivado", "Pagamento automático desativado", "Paiement automatique désactivé", "Peman otomatik etenn"],
  "bank": ["banco", "banco", "banque", "bank"],
  "card": ["tarjeta", "cartão", "carte", "kat"],
  "Home/unit info not added yet": ["Aún no ha agregado los datos de la vivienda/unidad", "Dados da casa/unidade ainda não adicionados", "Infos sur la maison/l'unité pas encore ajoutées", "Ou poko ajoute enfò sou kay/inite a"],
  "Rent-to-Own paid off — Bill of Sale": ["Alquiler con opción a compra pagado — contrato de compraventa", "Aluguel com opção de compra quitado — contrato de compra e venda", "Location avec option d'achat payée — acte de vente", "Lwaye pou achte fin peye — papye vant (Bill of Sale)"],
  "Rent-to-Own: {paid} of {total}": ["Alquiler con opción a compra: {paid} de {total}", "Aluguel com opção de compra: {paid} de {total}", "Location avec option d'achat : {paid} sur {total}", "Lwaye pou achte: {paid} sou {total}"],
  "Move-out requested: {date}": ["Mudanza solicitada: {date}", "Mudança solicitada: {date}", "Déménagement demandé : {date}", "Demenajman mande: {date}"],
  "Electric Charge {amount}": ["Cargo eléctrico {amount}", "Cobrança de energia {amount}", "Frais d'électricité {amount}", "Frè elektrisite {amount}"],
  "{n} occupant": ["{n} ocupante", "{n} ocupante", "{n} occupant", "{n} moun"],
  "{n} occupants": ["{n} ocupantes", "{n} ocupantes", "{n} occupants", "{n} moun"],
  "{n} visitor": ["{n} visitante", "{n} visitante", "{n} visiteur", "{n} vizitè"],
  "{n} visitors": ["{n} visitantes", "{n} visitantes", "{n} visiteurs", "{n} vizitè"],
  "{n} vehicle": ["{n} vehículo", "{n} veículo", "{n} véhicule", "{n} machin"],
  "{n} vehicles": ["{n} vehículos", "{n} veículos", "{n} véhicules", "{n} machin"],
  "{n} background check needed": ["Falta {n} verificación de antecedentes", "Falta {n} verificação de antecedentes", "{n} vérification des antécédents requise", "{n} verifikasyon dosye ki manke"],
  "{n} background checks needed": ["Faltan {n} verificaciones de antecedentes", "Faltam {n} verificações de antecedentes", "{n} vérifications des antécédents requises", "{n} verifikasyon dosye ki manke"],
  "{n} open maintenance request": ["{n} solicitud de mantenimiento abierta", "{n} solicitação de manutenção aberta", "{n} demande d'entretien ouverte", "{n} demann antretyen ki louvri"],
  "{n} open maintenance requests": ["{n} solicitudes de mantenimiento abiertas", "{n} solicitações de manutenção abertas", "{n} demandes d'entretien ouvertes", "{n} demann antretyen ki louvri"],
  "{n} propane order ready": ["{n} pedido de propano listo", "{n} pedido de propano pronto", "{n} commande de propane prête", "{n} kòmand pwopàn pare"],
  "{n} propane orders ready": ["{n} pedidos de propano listos", "{n} pedidos de propano prontos", "{n} commandes de propane prêtes", "{n} kòmand pwopàn pare"],
  "Request": ["Solicitud", "Solicitação", "Demande", "Demann"],
  "No messages yet": ["Aún no hay mensajes", "Nenhuma mensagem ainda", "Aucun message pour l'instant", "Poko gen mesaj"],

  // ---- Dashboard: Pay ----
  "Pay your monthly balance automatically": ["Pague su saldo mensual automáticamente", "Pague seu saldo mensal automaticamente", "Payez votre solde mensuel automatiquement", "Peye balans chak mwa ou otomatikman"],
  "Rent Amount": ["Monto del alquiler", "Valor do aluguel", "Montant du loyer", "Kantite lwaye a"],
  "Due on your account now": ["Por pagar en su cuenta ahora", "A pagar na sua conta agora", "À payer sur votre compte maintenant", "Sa ou dwe sou kont ou kounye a"],
  "Nothing due right now": ["No hay nada por pagar ahora", "Nada a pagar agora", "Rien à payer pour l'instant", "Pa gen anyen pou peye kounye a"],
  "🏦 Bank payment processing": ["🏦 Pago bancario en proceso", "🏦 Pagamento bancário em processamento", "🏦 Paiement bancaire en traitement", "🏦 Peman labank ap trete"],
  "Your bank payment was received and takes 3–5 business days to clear. There is nothing to pay on these invoices meanwhile.": ["Recibimos su pago bancario; tarda de 3 a 5 días hábiles en acreditarse. Mientras tanto no tiene que pagar nada en estas facturas.", "Recebemos seu pagamento bancário; ele leva de 3 a 5 dias úteis para compensar. Enquanto isso, não há nada a pagar nestas faturas.", "Votre paiement bancaire a été reçu et prend de 3 à 5 jours ouvrables à être réglé. Il n'y a rien à payer sur ces factures d'ici là.", "Nou resevwa peman labank ou a, li pran 3 a 5 jou ouvrab pou l pase. Pandan tan sa a, ou pa gen anyen pou peye sou fakti sa yo."],
  "Invoice — {month}": ["Factura — {month}", "Fatura — {month}", "Facture — {month}", "Fakti — {month}"],
  "Upcoming": ["Próximas", "Próximas", "À venir", "K ap vini"],
  "Being prepared — available {date}": ["En preparación — disponible el {date}", "Em preparação — disponível em {date}", "En préparation — disponible le {date}", "Ap prepare — l ap disponib {date}"],
  "available to pay on {date}": ["disponible para pagar el {date}", "disponível para pagamento em {date}", "payable à partir du {date}", "ou ka peye l apati {date}"],
  "Pay ahead (optional)": ["Pagar por adelantado (opcional)", "Pagar adiantado (opcional)", "Payer d'avance (facultatif)", "Peye davans (si ou vle)"],
  "Next month's invoice is ready. You can pay it now if you like, or any time until its due date.": ["La factura del próximo mes ya está lista. Puede pagarla ahora si desea, o en cualquier momento antes de su vencimiento.", "A fatura do próximo mês já está pronta. Você pode pagá-la agora, se quiser, ou a qualquer momento até o vencimento.", "La facture du mois prochain est prête. Vous pouvez la payer maintenant si vous le souhaitez, ou à tout moment jusqu'à sa date d'échéance.", "Fakti mwa pwochen an pare. Ou ka peye l kounye a si ou vle, oswa nenpòt ki lè jiska dat limit li."],
  "Next month's invoice is ready. You can pay it now if you like, or any time until its due date — autopay pays it on the due date.": ["La factura del próximo mes ya está lista. Puede pagarla ahora si desea, o en cualquier momento antes de su vencimiento — el pago automático la paga en la fecha de vencimiento.", "A fatura do próximo mês já está pronta. Você pode pagá-la agora, se quiser, ou a qualquer momento até o vencimento — o pagamento automático a paga no dia do vencimento.", "La facture du mois prochain est prête. Vous pouvez la payer maintenant si vous le souhaitez, ou à tout moment jusqu'à sa date d'échéance — le paiement automatique la paiera à la date d'échéance.", "Fakti mwa pwochen an pare. Ou ka peye l kounye a si ou vle, oswa nenpòt ki lè jiska dat limit li — peman otomatik la ap peye l nan dat limit la."],
  "Invoice — {month} · due {date}": ["Factura — {month} · vence el {date}", "Fatura — {month} · vence em {date}", "Facture — {month} · due le {date}", "Fakti — {month} · dat limit {date}"],
  "Pay ahead {amount}": ["Pagar por adelantado {amount}", "Pagar adiantado {amount}", "Payer d'avance {amount}", "Peye davans {amount}"],
  "Outstanding Charges": ["Cargos pendientes", "Cobranças em aberto", "Frais impayés", "Frè ki poko peye"],
  "Rent + any recurring charges": ["Alquiler + cargos recurrentes", "Aluguel + cobranças recorrentes", "Loyer + frais récurrents", "Lwaye + frè ki repete chak mwa"],
  "Invoice Total": ["Total de la factura", "Total da fatura", "Total de la facture", "Total fakti a"],
  "Total Due": ["Total a pagar", "Total a pagar", "Total à payer", "Total pou peye"],
  "Pay Online": ["Pagar en línea", "Pagar on-line", "Payer en ligne", "Peye sou entènèt"],
  "🧾 Invoices": ["🧾 Facturas", "🧾 Faturas", "🧾 Factures", "🧾 Fakti"],
  "View your monthly invoices and charges.": ["Vea sus facturas mensuales y cargos.", "Veja suas faturas mensais e cobranças.", "Consultez vos factures et frais mensuels.", "Gade fakti ak frè chak mwa ou yo."],
  "📜 Payment History": ["📜 Historial de pagos", "📜 Histórico de pagamentos", "📜 Historique des paiements", "📜 Istorik peman"],
  "View completed payments.": ["Vea los pagos realizados.", "Veja os pagamentos concluídos.", "Consultez les paiements effectués.", "Gade peman ou fin fè yo."],
  "⚡ Electric Usage": ["⚡ Consumo eléctrico", "⚡ Consumo de energia", "⚡ Consommation d'électricité", "⚡ Konsomasyon elektrisite"],
  "No electric usage available yet.": ["Todavía no hay consumo eléctrico disponible.", "Ainda não há consumo de energia disponível.", "Aucune donnée de consommation d'électricité pour l'instant.", "Poko gen done sou konsomasyon elektrisite."],
  "Billing Month": ["Mes de facturación", "Mês de cobrança", "Mois de facturation", "Mwa fakti a"],
  "Meter Number": ["Número de medidor", "Número do medidor", "Numéro de compteur", "Nimewo kontè"],
  "This Month's Usage": ["Lectura de este mes", "Leitura deste mês", "Relevé de ce mois-ci", "Lekti mwa sa a"],
  "Last Month's Usage": ["Lectura del mes pasado", "Leitura do mês passado", "Relevé du mois dernier", "Lekti mwa pase"],
  "Days of Service": ["Días de servicio", "Dias de serviço", "Jours de service", "Jou sèvis"],
  "Included kWh": ["kWh incluidos", "kWh incluídos", "kWh inclus", "kWh ki enkli"],
  "Billable kWh": ["kWh facturables", "kWh cobrados", "kWh facturables", "kWh pou peye"],
  "Rate per kWh": ["Tarifa por kWh", "Tarifa por kWh", "Tarif par kWh", "Pri pou chak kWh"],
  "Electric Charge": ["Cargo eléctrico", "Cobrança de energia", "Frais d'électricité", "Frè elektrisite"],
  "📊 Electric Usage History": ["📊 Historial de consumo eléctrico", "📊 Histórico de consumo de energia", "📊 Historique de consommation d'électricité", "📊 Istorik konsomasyon elektrisite"],
  "View monthly electric readings, charges, and usage history.": ["Vea las lecturas mensuales, los cargos y el historial de consumo.", "Veja as leituras mensais, as cobranças e o histórico de consumo.", "Consultez vos relevés d'électricité mensuels, vos frais et l'historique de consommation.", "Gade lekti elektrisite chak mwa, frè yo ak istorik konsomasyon ou."],
  "N/A": ["N/D", "N/D", "S. O.", "Pa genyen"],

  // ---- Dashboard: pay-method dialog ----
  "How would you like to pay?": ["¿Cómo desea pagar?", "Como você quer pagar?", "Comment souhaitez-vous payer?", "Kijan ou vle peye?"],
  "Paying ahead": ["Pago por adelantado", "Pagamento adiantado", "Paiement d'avance", "Peman davans"],
  "Balance": ["Saldo", "Saldo", "Solde", "Balans"],
  "Payment method": ["Forma de pago", "Forma de pagamento", "Mode de paiement", "Mwayen peman"],
  "Pay by bank (ACH)": ["Pagar con cuenta bancaria (ACH)", "Pagar com conta bancária (ACH)", "Payer par compte bancaire (ACH)", "Peye ak kont labank (ACH)"],
  "Pay by card": ["Pagar con tarjeta", "Pagar com cartão", "Payer par carte", "Peye ak kat"],
  "fee {amount}": ["cargo de {amount}", "taxa de {amount}", "frais de {amount}", "frè {amount}"],
  "no fee": ["sin cargo", "sem taxa", "sans frais", "san frè"],
  " — {amount} less than card": [" — {amount} menos que con tarjeta", " — {amount} a menos que no cartão", " — {amount} de moins que par carte", " — {amount} mwens pase ak kat"],
  " · clears in 3–5 business days": [" · se acredita en 3 a 5 días hábiles", " · compensa em 3 a 5 dias úteis", " · réglé d'ici 3 à 5 jours ouvrables", " · l ap pase nan 3 a 5 jou ouvrab"],
  " · paid instantly": [" · se paga al instante", " · pago na hora", " · payé instantanément", " · peye touswit"],
  "Recommended · lowest fee": ["Recomendado · cargo más bajo", "Recomendado · menor taxa", "Recommandé · frais les plus bas", "Rekòmande · frè ki pi ba"],
  "Recommended": ["Recomendado", "Recomendado", "Recommandé", "Rekòmande"],
  "Continue to pay by bank": ["Continuar para pagar con banco", "Continuar para pagar com banco", "Continuer pour payer par banque", "Kontinye pou peye ak bank"],
  "Continue to pay by card": ["Continuar para pagar con tarjeta", "Continuar para pagar com cartão", "Continuer pour payer par carte", "Kontinye pou peye ak kat"],
  "Opening secure payment…": ["Abriendo el pago seguro…", "Abrindo o pagamento seguro…", "Ouverture du paiement sécurisé…", "N ap louvri peman an an sekirite…"],

  // ---- Returned-payment fee (server phrase, translated) ----
  "If your bank returns a payment, {phrase}.": ["Si su banco devuelve un pago, {phrase}.", "Se o seu banco devolver um pagamento, {phrase}.", "Si votre banque retourne un paiement, {phrase}.", "Si bank ou voye yon peman tounen, {phrase}."],
  "a returned-payment fee of $29–$35 applies (the returned-payment processing cost plus a service charge allowed by Florida law)": ["se cobra un cargo por pago devuelto de $29 a $35 (el costo de procesar el pago devuelto más un cargo por servicio permitido por la ley de Florida)", "é cobrada uma taxa de pagamento devolvido de US$ 29 a US$ 35 (o custo de processar o pagamento devolvido mais uma taxa de serviço permitida pela lei da Flórida)", "des frais de paiement retourné de 29 $ à 35 $ s'appliquent (les frais de traitement du paiement retourné plus des frais de service permis par la loi de la Floride)", "gen yon frè peman retounen 29 $ a 35 $ (frè pou trete peman ki retounen an plis yon frè sèvis lalwa Florid pèmèt)"],
  "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, applies": ["se cobra un cargo por pago devuelto de {flat} o el {pct}% del monto de la factura, lo que sea mayor", "é cobrada uma taxa de pagamento devolvido de {flat} ou {pct}% do valor da fatura, o que for maior", "des frais de paiement retourné de {flat} ou de {pct} % du montant de la facture, selon le montant le plus élevé, s'appliquent", "gen yon frè peman retounen {flat} oswa {pct}% kantite fakti a, sa ki pi plis la"],
  "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, up to {cap}, applies": ["se cobra un cargo por pago devuelto de {flat} o el {pct}% del monto de la factura, lo que sea mayor, hasta {cap}", "é cobrada uma taxa de pagamento devolvido de {flat} ou {pct}% do valor da fatura, o que for maior, até {cap}", "des frais de paiement retourné de {flat} ou de {pct} % du montant de la facture, selon le montant le plus élevé, jusqu'à {cap}, s'appliquent", "gen yon frè peman retounen {flat} oswa {pct}% kantite fakti a, sa ki pi plis la, jiska {cap}"],
  "a returned-payment fee of {flat} applies": ["se cobra un cargo por pago devuelto de {flat}", "é cobrada uma taxa de pagamento devolvido de {flat}", "des frais de paiement retourné de {flat} s'appliquent", "gen yon frè peman retounen {flat}"],

  // ---- Dashboard: My lot & home ----
  "🎉 Your Rent-to-Own home is fully paid off!": ["🎉 ¡Su vivienda de alquiler con opción a compra está totalmente pagada!", "🎉 Sua casa do aluguel com opção de compra está totalmente quitada!", "🎉 Votre maison en location avec option d'achat est entièrement payée!", "🎉 Kay lwaye pou achte ou a fin peye nèt!"],
  "To finalize your Bill of Sale, both you and the park need to digitally sign. Type your full legal name below to sign your side.": ["Para finalizar su contrato de compraventa, usted y el parque deben firmarlo digitalmente. Escriba abajo su nombre legal completo para firmar su parte.", "Para finalizar seu contrato de compra e venda, você e o parque precisam assinar digitalmente. Digite abaixo seu nome legal completo para assinar a sua parte.", "Pour finaliser votre acte de vente, vous et le parc devez signer électroniquement. Tapez votre nom légal complet ci-dessous pour signer de votre côté.", "Pou fini papye vant ou (Bill of Sale), ni ou ni pak la dwe siyen sou entènèt. Tape non legal konplè ou anba a pou siyen pa w la."],
  "✓ You signed on {date}.": ["✓ Usted firmó el {date}.", "✓ Você assinou em {date}.", "✓ Vous avez signé le {date}.", "✓ Ou te siyen {date}."],
  "Waiting on the final document to generate — refresh in a moment.": ["Esperando que se genere el documento final — actualice la página en un momento.", "Aguardando a geração do documento final — atualize a página em instantes.", "En attente de la création du document final — actualisez dans un instant.", "N ap tann dokiman final la fin fèt — rafrechi paj la nan yon ti moman."],
  "Waiting on the park's signature to finalize your Bill of Sale.": ["Esperando la firma del parque para finalizar su contrato de compraventa.", "Aguardando a assinatura do parque para finalizar seu contrato de compra e venda.", "En attente de la signature du parc pour finaliser votre acte de vente.", "N ap tann siyati pak la pou fini papye vant ou."],
  "Type your full legal name to sign": ["Escriba su nombre legal completo para firmar", "Digite seu nome legal completo para assinar", "Tapez votre nom légal complet pour signer", "Tape non legal konplè ou pou siyen"],
  "Signing...": ["Firmando...", "Assinando...", "Signature...", "Ap siyen..."],
  "Sign Bill of Sale": ["Firmar contrato de compraventa", "Assinar contrato de compra e venda", "Signer l'acte de vente", "Siyen papye vant lan"],
  "Signed! Your Bill of Sale is finalized — find it under Documents.": ["¡Firmado! Su contrato de compraventa está finalizado — lo encontrará en Documentos.", "Assinado! Seu contrato de compra e venda foi finalizado — ele está em Documentos.", "Signé! Votre acte de vente est finalisé — vous le trouverez sous Documents.", "Siyen! Papye vant ou fini — w ap jwenn li nan Dokiman."],
  "Signed! Waiting on the park's signature to finalize your Bill of Sale.": ["¡Firmado! Esperando la firma del parque para finalizar su contrato de compraventa.", "Assinado! Aguardando a assinatura do parque para finalizar seu contrato de compra e venda.", "Signé! En attente de la signature du parc pour finaliser votre acte de vente.", "Siyen! N ap tann siyati pak la pou fini papye vant ou."],
  "🏡 Rent-to-Own Plan": ["🏡 Plan de alquiler con opción a compra", "🏡 Plano de aluguel com opção de compra", "🏡 Plan de location avec option d'achat", "🏡 Plan lwaye pou achte"],
  "{amount}/month toward your total purchase price": ["{amount}/mes a cuenta del precio total de compra", "{amount}/mês para o preço total da compra", "{amount}/mois pour le prix d'achat total", "{amount}/mwa sou pri total acha a"],
  "{paid} paid of {total}": ["{paid} pagado de {total}", "{paid} pago de {total}", "{paid} payé sur {total}", "{paid} peye sou {total}"],
  "{amount} remaining": ["faltan {amount}", "faltam {amount}", "{amount} restant", "rete {amount}"],
  "{n} payment left": ["Queda {n} pago", "Falta {n} pagamento", "{n} paiement restant", "Rete {n} peman"],
  "{n} payments left": ["Quedan {n} pagos", "Faltam {n} pagamentos", "{n} paiements restants", "Rete {n} peman"],
  "🏠 Home/Unit Info": ["🏠 Datos de la vivienda/unidad", "🏠 Dados da casa/unidade", "🏠 Infos sur la maison/l'unité", "🏠 Enfò sou kay/inite a"],
  "RV": ["RV (casa rodante)", "RV (trailer)", "VR", "RV"],
  "Park Model": ["Park Model", "Park Model", "Maison de parc (Park Model)", "Park Model"],
  "Mobile Home": ["Casa móvil", "Casa móvel", "Maison mobile", "Kay mobil"],
  "Other": ["Otro", "Outro", "Autre", "Lòt"],
  "Make": ["Marca", "Marca", "Marque", "Mak"],
  "Model": ["Modelo", "Modelo", "Modèle", "Modèl"],
  "Year": ["Año", "Ano", "Année", "Ane"],
  "Length (ft)": ["Largo (pies)", "Comprimento (pés)", "Longueur (pi)", "Longè (pye)"],
  "Width (ft) — optional": ["Ancho (pies) — opcional", "Largura (pés) — opcional", "Largeur (pi) — facultatif", "Lajè (pye) — si ou vle"],
  "VIN / Tag #": ["VIN / número de placa", "VIN / número da placa", "NIV / n° de plaque", "VIN / nimewo plak"],
  "{n} ft": ["{n} pies", "{n} pés", "{n} pi", "{n} pye"],
  "Length not set": ["Largo sin indicar", "Comprimento não informado", "Longueur non indiquée", "Longè pa endike"],
  "VIN / Tag #: {value}": ["VIN / placa: {value}", "VIN / placa: {value}", "NIV / plaque : {value}", "VIN / plak: {value}"],
  "RV info saved.": ["Datos guardados.", "Dados salvos.", "Renseignements enregistrés.", "Enfòmasyon yo anrejistre."],
  "Could not save RV info: {detail}": ["No se pudieron guardar los datos: {detail}", "Não foi possível salvar os dados: {detail}", "Impossible d'enregistrer les infos du VR : {detail}", "Nou pa t kapab anrejistre enfò RV a: {detail}"],
  "Could not save RV info (unexpected error): {detail}": ["No se pudieron guardar los datos (error inesperado): {detail}", "Não foi possível salvar os dados (erro inesperado): {detail}", "Impossible d'enregistrer les infos du VR (erreur inattendue) : {detail}", "Nou pa t kapab anrejistre enfò RV a (erè nou pa t prevwa): {detail}"],
  "🅿️ Parking & Pets": ["🅿️ Estacionamiento y mascotas", "🅿️ Estacionamento e animais", "🅿️ Stationnement et animaux", "🅿️ Pakin ak bèt"],
  "Edit Pets": ["Editar mascotas", "Editar animais", "Modifier les animaux", "Modifye bèt yo"],
  "Parking:": ["Estacionamiento:", "Estacionamento:", "Stationnement :", "Pakin:"],
  "{n} space(s)": ["{n} espacio(s)", "{n} vaga(s)", "{n} place(s)", "{n} plas"],
  "Designated": ["Asignado", "Designada", "Attribué", "Asiyen"],
  "Not provided": ["No incluido", "Não incluído", "Non fourni", "Pa bay"],
  "Pets:": ["Mascotas:", "Animais:", "Animaux :", "Bèt:"],
  "{n} pet(s)": ["{n} mascota(s)", "{n} animal(is)", "{n} animal(aux)", "{n} bèt"],
  "Not permitted": ["No permitidas", "Não permitidos", "Non permis", "Pa pèmèt"],
  "Pet {n}": ["Mascota {n}", "Animal {n}", "Animal {n}", "Bèt {n}"],
  "{n} lbs": ["{n} lb", "{n} lb", "{n} lb", "{n} liv"],
  "Shots records provided": ["Registros de vacunas entregados", "Carteira de vacinação entregue", "Carnet de vaccination fourni", "Kanè vaksen an bay"],
  "Shots records not provided": ["Faltan los registros de vacunas", "Carteira de vacinação não entregue", "Carnet de vaccination non fourni", "Kanè vaksen an poko bay"],
  "Parking Sticker ID#(s):": ["Número(s) de calcomanía de estacionamiento:", "Número(s) do adesivo de estacionamento:", "N° de vignette(s) de stationnement :", "Nimewo etikèt pakin:"],
  "No vehicles on file": ["No hay vehículos registrados", "Nenhum veículo cadastrado", "Aucun véhicule au dossier", "Pa gen machin anrejistre"],
  "Not yet assigned": ["Aún no asignado", "Ainda não atribuído", "Pas encore attribué", "Poko asiyen"],
  "Gate Access Clickers Issued:": ["Controles del portón entregados:", "Controles do portão entregues:", "Télécommandes de barrière remises :", "Telekòmand baryè yo bay:"],
  "Mailbox Keys Issued:": ["Llaves del buzón entregadas:", "Chaves da caixa de correio entregues:", "Clés de boîte aux lettres remises :", "Kle bwat lèt yo bay:"],
  "Mailbox #:": ["Buzón n.º:", "Caixa de correio nº:", "Boîte aux lettres n° :", "Nimewo bwat lèt:"],
  "Lost or damaged items may be subject to a replacement fee — contact the office for details.": ["Los artículos perdidos o dañados pueden tener un cargo de reposición — consulte con la oficina.", "Itens perdidos ou danificados podem ter taxa de reposição — consulte o escritório.", "Des frais de remplacement peuvent s'appliquer aux articles perdus ou endommagés — communiquez avec le bureau pour en savoir plus.", "Ou ka gen pou peye pou ranplase bagay ki pèdi oswa ki gate — pale ak biwo a pou plis detay."],
  "I have pet(s)": ["Tengo mascota(s)", "Tenho animal(is)", "J'ai un ou des animaux", "Mwen gen bèt"],
  "How many pets?": ["¿Cuántas mascotas?", "Quantos animais?", "Combien d'animaux?", "Konbyen bèt?"],
  "Type": ["Tipo", "Tipo", "Type", "Kalite"],
  "e.g. Dog, Cat": ["p. ej. perro, gato", "ex.: cachorro, gato", "p. ex. chien, chat", "egz. chen, chat"],
  "Name of your pet": ["Nombre de su mascota", "Nome do seu animal", "Nom de votre animal", "Non bèt ou"],
  "Breed": ["Raza", "Raça", "Race", "Ras"],
  "Color": ["Color", "Cor", "Couleur", "Koulè"],
  "Weight (lbs)": ["Peso (libras)", "Peso (libras)", "Poids (lb)", "Pwa (liv)"],
  "Provided shots records?": ["¿Entregó los registros de vacunas?", "Entregou a carteira de vacinação?", "Carnet de vaccination fourni?", "Ou bay kanè vaksen an?"],
  "Select...": ["Seleccione...", "Selecione...", "Sélectionnez...", "Chwazi..."],
  "Please select how many pets you have.": ["Indique cuántas mascotas tiene.", "Informe quantos animais você tem.", "Veuillez indiquer combien d'animaux vous avez.", "Tanpri chwazi konbyen bèt ou genyen."],
  "Please fill in type, name, breed, color, weight, and shots records for each pet.": ["Complete tipo, nombre, raza, color, peso y registros de vacunas de cada mascota.", "Preencha tipo, nome, raça, cor, peso e carteira de vacinação de cada animal.", "Veuillez remplir le type, le nom, la race, la couleur, le poids et le carnet de vaccination pour chaque animal.", "Tanpri ranpli kalite, non, ras, koulè, pwa ak kanè vaksen pou chak bèt."],
  "Could not save pets: {detail}": ["No se pudieron guardar las mascotas: {detail}", "Não foi possível salvar os animais: {detail}", "Impossible d'enregistrer les animaux : {detail}", "Nou pa t kapab anrejistre bèt yo: {detail}"],
  "Could not save pets (unexpected error): {detail}": ["No se pudieron guardar las mascotas (error inesperado): {detail}", "Não foi possível salvar os animais (erro inesperado): {detail}", "Impossible d'enregistrer les animaux (erreur inattendue) : {detail}", "Nou pa t kapab anrejistre bèt yo (erè nou pa t prevwa): {detail}"],
  "📄 Documents": ["📄 Documentos", "📄 Documentos", "📄 Documents", "📄 Dokiman"],
  "View and print your signed site rental agreement and any signed resident agreements.": ["Vea e imprima su contrato de alquiler del espacio firmado y los acuerdos de residente firmados.", "Veja e imprima seu contrato de locação do espaço assinado e os acordos de morador assinados.", "Consultez et imprimez votre contrat de location de terrain signé et vos ententes de résident signées.", "Gade epi enprime kontra lwaye espas ou te siyen an ak tout akò rezidan ou te siyen."],
  "🚪 Moving Out?": ["🚪 ¿Se muda?", "🚪 Vai se mudar?", "🚪 Vous déménagez?", "🚪 W ap demenaje?"],
  "Let us know your planned move-out date.": ["Indíquenos la fecha en que planea mudarse.", "Informe a data em que planeja se mudar.", "Indiquez-nous la date prévue de votre déménagement.", "Fè nou konnen ki dat ou planifye pou w demenaje."],
  "Requested move-out date:": ["Fecha de mudanza solicitada:", "Data de mudança solicitada:", "Date de déménagement demandée :", "Dat demenajman ou mande:"],
  "Submitted ✓": ["Enviado ✓", "Enviado ✓", "Envoyé ✓", "Voye ✓"],
  "Request at least {n} day(s) before the event.": ["Pídalo con al menos {n} día(s) de anticipación.", "Peça com pelo menos {n} dia(s) de antecedência.", "Faites la demande au moins {n} jour(s) avant l'événement.", "Fè demann lan omwen {n} jou anvan evènman an."],
  "Please request the Rec Hall at least {n} day(s) before the event, so the hall can be prepared.": ["Pida el Rec Hall con al menos {n} día(s) de anticipación, para que se pueda preparar el salón.", "Peça o Rec Hall com pelo menos {n} dia(s) de antecedência, para que o salão possa ser preparado.", "Veuillez réserver le Rec Hall au moins {n} jour(s) avant l'événement, pour que la salle puisse être préparée.", "Tanpri mande Rec Hall la omwen {n} jou anvan evènman an, pou yo ka prepare sal la."],
  "Please give us at least {n} days notice.": ["Avísenos con al menos {n} días de anticipación.", "Avise-nos com pelo menos {n} dias de antecedência.", "Veuillez nous aviser au moins {n} jours à l'avance.", "Tanpri avèti nou omwen {n} jou davans."],
  "Before moving out, your outstanding balance must be $0.": ["Antes de mudarse, su saldo pendiente debe estar en $0.", "Antes de se mudar, seu saldo em aberto precisa estar zerado.", "Avant de déménager, votre solde doit être de 0 $.", "Anvan ou demenaje, balans ou dwe 0 $."],
  "Please check your email — the office will confirm your move-out date there once approved.": ["Revise su correo — la oficina le confirmará allí la fecha de mudanza cuando la apruebe.", "Verifique seu e-mail — o escritório confirmará a data da mudança por lá quando aprovar.", "Veuillez vérifier vos courriels — le bureau y confirmera votre date de déménagement une fois approuvée.", "Tanpri tcheke imel ou — biwo a ap konfime dat demenajman ou la lè yo apwouve l."],
  "Changed your mind, or need a different date? Cancel below, then submit a new one.": ["¿Cambió de idea o necesita otra fecha? Cancele abajo y luego envíe una nueva.", "Mudou de ideia ou precisa de outra data? Cancele abaixo e envie uma nova.", "Vous avez changé d'idée ou avez besoin d'une autre date? Annulez ci-dessous, puis envoyez-en une nouvelle.", "Ou chanje lide, oswa ou bezwen yon lòt dat? Anile anba a, epi voye yon nouvo dat."],
  "Cancelling...": ["Cancelando...", "Cancelando...", "Annulation...", "Ap anile..."],
  "Cancel Request": ["Cancelar solicitud", "Cancelar solicitação", "Annuler la demande", "Anile demann lan"],
  "Move-Out Date": ["Fecha de mudanza", "Data da mudança", "Date de déménagement", "Dat demenajman"],
  "Notes (optional)": ["Notas (opcional)", "Observações (opcional)", "Notes (facultatif)", "Nòt (si ou vle)"],
  "Sending...": ["Enviando...", "Enviando...", "Envoi...", "Ap voye..."],
  "Submit Move-Out Date": ["Enviar fecha de mudanza", "Enviar data da mudança", "Envoyer la date de déménagement", "Voye dat demenajman an"],
  "Please choose a date first.": ["Primero elija una fecha.", "Escolha uma data primeiro.", "Veuillez d'abord choisir une date.", "Tanpri chwazi yon dat anvan."],
  "Error: {detail}": ["Error: {detail}", "Erro: {detail}", "Erreur : {detail}", "Erè: {detail}"],
  "Cancel your move-out request? You can submit a new date afterward.": ["¿Cancelar su solicitud de mudanza? Después puede enviar una fecha nueva.", "Cancelar sua solicitação de mudança? Depois você pode enviar uma nova data.", "Annuler votre demande de déménagement? Vous pourrez envoyer une nouvelle date ensuite.", "Anile demann demenajman ou an? Ou ka voye yon nouvo dat apre."],

  // ---- Dashboard: Household ----
  "⚠️ Background Check Needed": ["⚠️ Se necesita verificación de antecedentes", "⚠️ Verificação de antecedentes necessária", "⚠️ Vérification des antécédents requise", "⚠️ Bezwen verifikasyon dosye"],
  "1 household occupant still needs a background check paid for and started.": ["A 1 ocupante del hogar todavía le falta pagar e iniciar la verificación de antecedentes.", "1 morador ainda precisa pagar e iniciar a verificação de antecedentes.", "1 occupant du ménage doit encore payer et commencer sa vérification des antécédents.", "1 moun nan fwaye a toujou bezwen peye epi kòmanse verifikasyon dosye li."],
  "{n} household occupants still need a background check paid for and started.": ["A {n} ocupantes del hogar todavía les falta pagar e iniciar la verificación de antecedentes.", "{n} moradores ainda precisam pagar e iniciar a verificação de antecedentes.", "{n} occupants du ménage doivent encore payer et commencer leur vérification des antécédents.", "{n} moun nan fwaye a toujou bezwen peye epi kòmanse verifikasyon dosye yo."],
  "Continue to Background Check(s)": ["Continuar a la(s) verificación(es) de antecedentes", "Continuar para a(s) verificação(ões) de antecedentes", "Continuer vers la ou les vérifications des antécédents", "Kontinye pou verifikasyon dosye"],
  "Household Occupants": ["Ocupantes del hogar", "Moradores da casa", "Occupants du ménage", "Moun nan fwaye a"],
  "People living here permanently. Anyone 18 or older requires a background check.": ["Personas que viven aquí de forma permanente. Toda persona de 18 años o más necesita verificación de antecedentes.", "Pessoas que moram aqui de forma permanente. Toda pessoa com 18 anos ou mais precisa de verificação de antecedentes.", "Personnes qui vivent ici de façon permanente. Toute personne de 18 ans ou plus doit faire une vérification des antécédents.", "Moun ki rete isit la pou toutan. Tout moun ki gen 18 an oswa plis bezwen yon verifikasyon dosye."],
  "Full Name": ["Nombre completo", "Nome completo", "Nom complet", "Non konplè"],
  "Relationship": ["Parentesco", "Parentesco", "Lien", "Relasyon"],
  "Phone": ["Teléfono", "Telefone", "Téléphone", "Telefòn"],
  "Email": ["Correo electrónico", "E-mail", "Courriel", "Imel"],
  "Date of Birth (required)": ["Fecha de nacimiento (obligatoria)", "Data de nascimento (obrigatória)", "Date de naissance (obligatoire)", "Dat nesans (obligatwa)"],
  "Social Security # (leave blank to keep the one on file)": ["Número de Seguro Social (déjelo en blanco para mantener el que ya tenemos)", "Número do Seguro Social (deixe em branco para manter o que já temos)", "N° d'assurance sociale (SSN) (laissez vide pour garder celui au dossier)", "Nimewo Sekirite Sosyal (kite l vid pou kenbe sa ki anrejistre a)"],
  "Social Security # (required for adults 18+)": ["Número de Seguro Social (obligatorio para mayores de 18 años)", "Número do Seguro Social (obrigatório para maiores de 18 anos)", "N° d'assurance sociale (SSN) (obligatoire pour les adultes de 18 ans et plus)", "Nimewo Sekirite Sosyal (obligatwa pou granmoun 18 an oswa plis)"],
  "Email is also required for adults. Stored securely; the office only sees the last 4 digits.": ["El correo también es obligatorio para adultos. Se guarda de forma segura; la oficina solo ve los últimos 4 dígitos.", "O e-mail também é obrigatório para adultos. Fica guardado com segurança; o escritório só vê os 4 últimos dígitos.", "Le courriel est aussi obligatoire pour les adultes. Conservé en toute sécurité; le bureau ne voit que les 4 derniers chiffres.", "Imel la obligatwa tou pou granmoun. Li sere an sekirite; biwo a wè sèlman 4 dènye chif yo."],
  "Update Occupant": ["Actualizar ocupante", "Atualizar ocupante", "Mettre à jour l'occupant", "Mete moun nan ajou"],
  "Date of Birth: {date}": ["Fecha de nacimiento: {date}", "Data de nascimento: {date}", "Date de naissance : {date}", "Dat nesans: {date}"],
  " · Age: {n}": [" · Edad: {n}", " · Idade: {n}", " · Âge : {n}", " · Laj: {n}"],
  "Age: {n}": ["Edad: {n}", "Idade: {n}", "Âge : {n}", "Laj: {n}"],
  "Background check: {status}": ["Verificación de antecedentes: {status}", "Verificação de antecedentes: {status}", "Vérification des antécédents : {status}", "Verifikasyon dosye: {status}"],
  "This person is 18 or older — a background check is required before move-in is compliant.": ["Esta persona tiene 18 años o más — se requiere verificación de antecedentes para que la mudanza cumpla con las normas.", "Esta pessoa tem 18 anos ou mais — é necessária verificação de antecedentes para a mudança estar em conformidade.", "Cette personne a 18 ans ou plus — une vérification des antécédents est requise pour que l'emménagement soit conforme.", "Moun sa a gen 18 an oswa plis — li bezwen yon verifikasyon dosye pou demenajman l nan pak la an règ."],
  "Please upload a photo ID in Documents, then proceed with the background check.": ["Suba una identificación con foto en Documentos y luego continúe con la verificación de antecedentes.", "Envie um documento com foto em Documentos e depois siga com a verificação de antecedentes.", "Veuillez téléverser une pièce d'identité avec photo dans Documents, puis faites la vérification des antécédents.", "Tanpri voye yon ID ak foto nan Dokiman, apre sa kontinye ak verifikasyon dosye a."],
  "Upload ID": ["Subir identificación", "Enviar documento", "Téléverser une pièce d'identité", "Voye ID"],
  "ID received. Now proceed with the background check.": ["Identificación recibida. Ahora continúe con la verificación de antecedentes.", "Documento recebido. Agora siga com a verificação de antecedentes.", "Pièce d'identité reçue. Faites maintenant la vérification des antécédents.", "Nou resevwa ID a. Kounye a kontinye ak verifikasyon dosye a."],
  "Proceed with Background Check": ["Continuar con la verificación de antecedentes", "Seguir com a verificação de antecedentes", "Faire la vérification des antécédents", "Kontinye ak verifikasyon dosye a"],
  "No household occupants listed.": ["No hay ocupantes del hogar registrados.", "Nenhum morador cadastrado.", "Aucun occupant du ménage inscrit.", "Pa gen moun nan fwaye a ki anrejistre."],
  "Temporary guests. You can add, edit, or remove these anytime.": ["Invitados temporales. Puede agregarlos, editarlos o quitarlos cuando quiera.", "Hóspedes temporários. Você pode adicionar, editar ou remover quando quiser.", "Invités temporaires. Vous pouvez les ajouter, les modifier ou les retirer en tout temps.", "Envite tanporè. Ou ka ajoute, modifye oswa retire yo nenpòt ki lè."],
  "Stay Start Date (required)": ["Fecha de llegada (obligatoria)", "Data de chegada (obrigatória)", "Date d'arrivée (obligatoire)", "Dat rive (obligatwa)"],
  "Stay End Date (required)": ["Fecha de salida (obligatoria)", "Data de saída (obrigatória)", "Date de départ (obligatoire)", "Dat depa (obligatwa)"],
  "Update Visitor": ["Actualizar visitante", "Atualizar visitante", "Mettre à jour le visiteur", "Mete vizitè a ajou"],
  "Save Visitor": ["Guardar visitante", "Salvar visitante", "Enregistrer le visiteur", "Anrejistre vizitè a"],
  "Stay: {start} to {end}": ["Estadía: del {start} al {end}", "Estadia: de {start} a {end}", "Séjour : du {start} au {end}", "Sejou: {start} rive {end}"],
  "No visitors listed.": ["No hay visitantes registrados.", "Nenhum visitante cadastrado.", "Aucun visiteur inscrit.", "Pa gen vizitè ki anrejistre."],
  "License Plate": ["Placa", "Placa", "Plaque d'immatriculation", "Plak"],
  "License State": ["Estado de la placa", "Estado da placa", "Province/État de la plaque", "Eta plak la"],
  "Update Vehicle": ["Actualizar vehículo", "Atualizar veículo", "Mettre à jour le véhicule", "Mete machin nan ajou"],
  "Save Vehicle": ["Guardar vehículo", "Salvar veículo", "Enregistrer le véhicule", "Anrejistre machin nan"],
  "Plate: {value}": ["Placa: {value}", "Placa: {value}", "Plaque : {value}", "Plak: {value}"],
  "Parking Sticker ID#: {value}": ["Calcomanía de estacionamiento n.º: {value}", "Adesivo de estacionamento nº: {value}", "N° de vignette de stationnement : {value}", "Nimewo etikèt pakin: {value}"],
  "No vehicles listed.": ["No hay vehículos registrados.", "Nenhum veículo cadastrado.", "Aucun véhicule inscrit.", "Pa gen machin ki anrejistre."],
  "Please enter a full name.": ["Escriba el nombre completo.", "Digite o nome completo.", "Veuillez entrer un nom complet.", "Tanpri ekri non konplè a."],
  "Please enter both a Stay Start Date and Stay End Date.": ["Indique la fecha de llegada y la fecha de salida.", "Informe a data de chegada e a data de saída.", "Veuillez entrer une date d'arrivée et une date de départ.", "Tanpri mete yon dat rive ak yon dat depa."],
  "Please enter this person's Date of Birth.": ["Indique la fecha de nacimiento de esta persona.", "Informe a data de nascimento desta pessoa.", "Veuillez entrer la date de naissance de cette personne.", "Tanpri mete dat nesans moun sa a."],
  "Please enter a valid email for this adult (18+).": ["Escriba un correo válido para este adulto (18+).", "Digite um e-mail válido para este adulto (18+).", "Veuillez entrer un courriel valide pour cet adulte (18 ans et plus).", "Tanpri mete yon imel ki bon pou granmoun sa a (18 an oswa plis)."],
  "Please enter this adult's Social Security # (9 digits).": ["Escriba el número de Seguro Social de este adulto (9 dígitos).", "Digite o número do Seguro Social deste adulto (9 dígitos).", "Veuillez entrer le n° d'assurance sociale (SSN) de cet adulte (9 chiffres).", "Tanpri mete nimewo Sekirite Sosyal granmoun sa a (9 chif)."],
  "Social Security # must be 9 digits (or leave it blank to keep the one on file).": ["El número de Seguro Social debe tener 9 dígitos (o déjelo en blanco para mantener el que ya tenemos).", "O número do Seguro Social precisa ter 9 dígitos (ou deixe em branco para manter o que já temos).", "Le n° d'assurance sociale (SSN) doit comporter 9 chiffres (ou laissez-le vide pour garder celui au dossier).", "Nimewo Sekirite Sosyal la dwe gen 9 chif (oswa kite l vid pou kenbe sa ki anrejistre a)."],
  "Could not update visitor: {detail}": ["No se pudo actualizar: {detail}", "Não foi possível atualizar: {detail}", "Impossible de mettre à jour le visiteur : {detail}", "Nou pa t kapab mete vizitè a ajou: {detail}"],
  "Could not add: {detail}": ["No se pudo agregar: {detail}", "Não foi possível adicionar: {detail}", "Impossible d'ajouter : {detail}", "Nou pa t kapab ajoute: {detail}"],
  "Could not save (unexpected error): {detail}": ["No se pudo guardar (error inesperado): {detail}", "Não foi possível salvar (erro inesperado): {detail}", "Impossible d'enregistrer (erreur inattendue) : {detail}", "Nou pa t kapab anrejistre (erè nou pa t prevwa): {detail}"],
  "Remove this person?": ["¿Quitar a esta persona?", "Remover esta pessoa?", "Retirer cette personne?", "Retire moun sa a?"],
  "Could not remove: {detail}": ["No se pudo quitar: {detail}", "Não foi possível remover: {detail}", "Impossible de retirer : {detail}", "Nou pa t kapab retire: {detail}"],
  "Could not remove (unexpected error): {detail}": ["No se pudo quitar (error inesperado): {detail}", "Não foi possível remover (erro inesperado): {detail}", "Impossible de retirer (erreur inattendue) : {detail}", "Nou pa t kapab retire (erè nou pa t prevwa): {detail}"],
  "Please enter a license plate.": ["Escriba la placa.", "Digite a placa.", "Veuillez entrer une plaque d'immatriculation.", "Tanpri mete nimewo plak la."],
  "Could not update vehicle: {detail}": ["No se pudo actualizar el vehículo: {detail}", "Não foi possível atualizar o veículo: {detail}", "Impossible de mettre à jour le véhicule : {detail}", "Nou pa t kapab mete machin nan ajou: {detail}"],
  "Could not add vehicle: {detail}": ["No se pudo agregar el vehículo: {detail}", "Não foi possível adicionar o veículo: {detail}", "Impossible d'ajouter le véhicule : {detail}", "Nou pa t kapab ajoute machin nan: {detail}"],
  "Could not save vehicle (unexpected error): {detail}": ["No se pudo guardar el vehículo (error inesperado): {detail}", "Não foi possível salvar o veículo (erro inesperado): {detail}", "Impossible d'enregistrer le véhicule (erreur inattendue) : {detail}", "Nou pa t kapab anrejistre machin nan (erè nou pa t prevwa): {detail}"],
  "Remove this vehicle?": ["¿Quitar este vehículo?", "Remover este veículo?", "Retirer ce véhicule?", "Retire machin sa a?"],
  "Could not remove vehicle: {detail}": ["No se pudo quitar el vehículo: {detail}", "Não foi possível remover o veículo: {detail}", "Impossible de retirer le véhicule : {detail}", "Nou pa t kapab retire machin nan: {detail}"],
  "Could not remove vehicle (unexpected error): {detail}": ["No se pudo quitar el vehículo (error inesperado): {detail}", "Não foi possível remover o veículo (erro inesperado): {detail}", "Impossible de retirer le véhicule (erreur inattendue) : {detail}", "Nou pa t kapab retire machin nan (erè nou pa t prevwa): {detail}"],

  // ---- Dashboard: Requests ----
  "Maintenance Requests": ["Solicitudes de mantenimiento", "Solicitações de manutenção", "Demandes d'entretien", "Demann antretyen"],
  "Report issues and track maintenance progress.": ["Reporte problemas y siga el avance del mantenimiento.", "Informe problemas e acompanhe o andamento da manutenção.", "Signalez des problèmes et suivez l'avancement de l'entretien.", "Siyale pwoblèm epi swiv kote travay antretyen yo rive."],
  "Maintenance requests are handled by the office — please call or message us.": ["La oficina atiende las solicitudes de mantenimiento — llámenos o escríbanos.", "O escritório cuida das solicitações de manutenção — ligue ou envie uma mensagem.", "Les demandes d'entretien sont traitées par le bureau — veuillez nous appeler ou nous écrire.", "Se biwo a ki okipe demann antretyen yo — tanpri rele nou oswa voye yon mesaj ban nou."],
  "Open Requests": ["Solicitudes abiertas", "Solicitações abertas", "Demandes ouvertes", "Demann ki louvri"],
  "Maintenance request": ["Solicitud de mantenimiento", "Solicitação de manutenção", "Demande d'entretien", "Demann antretyen"],
  " · {p} priority": [" · prioridad {p}", " · prioridade {p}", " · priorité {p}", " · priyorite {p}"],
  "⛽ Propane Orders": ["⛽ Pedidos de propano", "⛽ Pedidos de propano", "⛽ Commandes de propane", "⛽ Kòmand pwopàn"],
  "Propane pickup QR code": ["Código QR para recoger el propano", "Código QR para retirar o propano", "Code QR pour récupérer le propane", "Kòd QR pou pran pwopàn nan"],
  "{n} gallons": ["{n} galones", "{n} galões", "{n} gallons", "{n} galon"],
  "{amount} — paid {date}": ["{amount} — pagado el {date}", "{amount} — pago em {date}", "{amount} — payé le {date}", "{amount} — peye {date}"],
  "✅ Fully picked up": ["✅ Recogido por completo", "✅ Totalmente retirado", "✅ Entièrement récupéré", "✅ Ou pran tout"],
  "🕓 Picked up {count}/{max} — show this code to staff for the rest": ["🕓 Recogido {count}/{max} — muestre este código al personal para el resto", "🕓 Retirado {count}/{max} — mostre este código à equipe para o restante", "🕓 Récupéré {count}/{max} — montrez ce code au personnel pour le reste", "🕓 Ou pran {count}/{max} — montre anplwaye a kòd sa a pou rès la"],
  "🕓 Ready for pickup — show this code to staff": ["🕓 Listo para recoger — muestre este código al personal", "🕓 Pronto para retirada — mostre este código à equipe", "🕓 Prêt à récupérer — montrez ce code au personnel", "🕓 Pare pou w vin pran — montre anplwaye a kòd sa a"],
  "Remove from my portal": ["Quitar de mi portal", "Remover do meu portal", "Retirer de mon portail", "Retire l nan pòtay mwen"],

  // ---- Dashboard: Messages ----
  "🔔 Notifications": ["🔔 Notificaciones", "🔔 Notificações", "🔔 Notifications", "🔔 Notifikasyon"],
  "No announcements from the park right now.": ["El parque no tiene anuncios por ahora.", "O parque não tem avisos no momento.", "Aucune annonce du parc pour l'instant.", "Pak la pa gen anons kounye a."],

  // ---- Dashboard: Profile & more ----
  "Resident Information": ["Información del residente", "Informações do morador", "Renseignements du résident", "Enfòmasyon rezidan"],
  "Email:": ["Correo:", "E-mail:", "Courriel :", "Imel:"],
  "No email": ["Sin correo", "Sem e-mail", "Aucun courriel", "Pa gen imel"],
  "Phone:": ["Teléfono:", "Telefone:", "Téléphone :", "Telefòn:"],
  "No phone": ["Sin teléfono", "Sem telefone", "Aucun téléphone", "Pa gen telefòn"],
  "Edit Resident Information": ["Editar información del residente", "Editar informações do morador", "Modifier les renseignements du résident", "Modifye enfòmasyon rezidan"],
  "Emergency Contact": ["Contacto de emergencia", "Contato de emergência", "Contact d'urgence", "Kontak an ka ijans"],
  "Name:": ["Nombre:", "Nome:", "Nom :", "Non:"],
  "Relationship:": ["Parentesco:", "Parentesco:", "Lien :", "Relasyon:"],
  "None": ["Ninguno", "Nenhum", "Aucun", "Okenn"],
  "Edit Emergency Contact": ["Editar contacto de emergencia", "Editar contato de emergência", "Modifier le contact d'urgence", "Modifye kontak an ka ijans lan"],
  "Name": ["Nombre", "Nome", "Nom", "Non"],
  "e.g. Mother, Spouse, Friend": ["p. ej. madre, esposo(a), amigo(a)", "ex.: mãe, cônjuge, amigo(a)", "p. ex. mère, conjoint(e), ami(e)", "egz. manman, mari/madanm, zanmi"],
  "Could not save changes: {detail}": ["No se pudieron guardar los cambios: {detail}", "Não foi possível salvar as alterações: {detail}", "Impossible d'enregistrer les modifications : {detail}", "Nou pa t kapab anrejistre chanjman yo: {detail}"],
  "Could not save changes (unexpected error): {detail}": ["No se pudieron guardar los cambios (error inesperado): {detail}", "Não foi possível salvar as alterações (erro inesperado): {detail}", "Impossible d'enregistrer les modifications (erreur inattendue) : {detail}", "Nou pa t kapab anrejistre chanjman yo (erè nou pa t prevwa): {detail}"],
  "🛍️ Marketplace": ["🛍️ Marketplace", "🛍️ Marketplace", "🛍️ Marketplace", "🛍️ Marketplace"],
  "Buy and sell with your neighbors.": ["Compre y venda con sus vecinos.", "Compre e venda com seus vizinhos.", "Achetez et vendez entre voisins.", "Achte ak vann ak vwazen ou yo."],

  // ---- AutopaySection ----
  "Please check the box to authorize the monthly automatic charge.": ["Marque la casilla para autorizar el cobro automático mensual.", "Marque a caixa para autorizar a cobrança automática mensal.", "Veuillez cocher la case pour autoriser le prélèvement automatique mensuel.", "Tanpri tcheke bwat la pou otorize peman otomatik chak mwa a."],
  "Could not start card setup.": ["No se pudo iniciar el registro de la tarjeta.", "Não foi possível iniciar o cadastro do cartão.", "Impossible de lancer l'ajout de la carte.", "Nou pa t kapab kòmanse anrejistre kat la."],
  "Card field not ready.": ["El campo de la tarjeta aún no está listo.", "O campo do cartão ainda não está pronto.", "Le champ de la carte n'est pas encore prêt.", "Espas pou kat la poko pare."],
  "Could not save card.": ["No se pudo guardar la tarjeta.", "Não foi possível salvar o cartão.", "Impossible d'enregistrer la carte.", "Nou pa t kapab anrejistre kat la."],
  "Could not enable autopay.": ["No se pudo activar el pago automático.", "Não foi possível ativar o pagamento automático.", "Impossible d'activer le paiement automatique.", "Nou pa t kapab limen peman otomatik la."],
  "Recurring Charge Authorization": ["Autorización de cobro recurrente", "Autorização de cobrança recorrente", "Autorisation de paiements récurrents", "Otorizasyon pou peman ki repete"],
  "I have read and agree to this authorization.": ["He leído y acepto esta autorización.", "Li e aceito esta autorização.", "J'ai lu et j'accepte cette autorisation.", "Mwen li otorizasyon sa a epi mwen dakò."],
  "Save Card & Enable Autopay": ["Guardar tarjeta y activar pago automático", "Salvar cartão e ativar pagamento automático", "Enregistrer la carte et activer le paiement automatique", "Anrejistre kat la epi limen peman otomatik"],
  "Please check the box to authorize the automatic bank payments.": ["Marque la casilla para autorizar los pagos bancarios automáticos.", "Marque a caixa para autorizar os pagamentos bancários automáticos.", "Veuillez cocher la case pour autoriser les paiements bancaires automatiques.", "Tanpri tcheke bwat la pou otorize peman otomatik labank yo."],
  "Could not open the secure page. Please try again.": ["No se pudo abrir la página segura. Inténtelo de nuevo.", "Não foi possível abrir a página segura. Tente novamente.", "Impossible d'ouvrir la page sécurisée. Veuillez réessayer.", "Nou pa t kapab louvri paj sekirize a. Tanpri eseye ankò."],
  "Link your checking or savings account on a <b>secure page</b> — log in to your bank, no account numbers to type.": ["Vincule su cuenta corriente o de ahorros en una <b>página segura</b> — entre a su banco, sin escribir números de cuenta.", "Vincule sua conta corrente ou poupança em uma <b>página segura</b> — entre no seu banco, sem digitar números de conta.", "Liez votre compte chèques ou épargne sur une <b>page sécurisée</b> — connectez-vous à votre banque, aucun numéro de compte à taper.", "Konekte kont chèk oswa kont epay ou sou yon <b>paj sekirize</b> — antre nan bank ou, ou pa bezwen tape nimewo kont."],
  "Each payment takes <b>3–5 business days</b> to clear.": ["Cada pago tarda <b>de 3 a 5 días hábiles</b> en acreditarse.", "Cada pagamento leva <b>de 3 a 5 dias úteis</b> para compensar.", "Chaque paiement prend <b>3 à 5 jours ouvrables</b> à être réglé.", "Chak peman pran <b>3 a 5 jou ouvrab</b> pou l pase."],
  "Balances of <b>{amount}</b> or more are paid automatically; a smaller balance is added to the next one (you can always pay it yourself).": ["Los saldos de <b>{amount}</b> o más se pagan automáticamente; un saldo menor se suma al siguiente (siempre puede pagarlo usted mismo).", "Saldos de <b>{amount}</b> ou mais são pagos automaticamente; um saldo menor é somado ao próximo (você sempre pode pagá-lo por conta própria).", "Les soldes de <b>{amount}</b> ou plus sont payés automatiquement; un solde plus petit est ajouté au suivant (vous pouvez toujours le payer vous-même).", "Balans <b>{amount}</b> oswa plis peye otomatikman; yon balans ki pi piti ajoute sou pwochen an (ou ka toujou peye l oumenm)."],
  "Bank debit (ACH) authorization": ["Autorización de débito bancario (ACH)", "Autorização de débito bancário (ACH)", "Autorisation de prélèvement bancaire (ACH)", "Otorizasyon pou retire lajan nan bank (ACH)"],
  "Opening secure page...": ["Abriendo la página segura...", "Abrindo a página segura...", "Ouverture de la page sécurisée...", "N ap louvri paj sekirize a..."],
  "Link my bank & turn on autopay": ["Vincular mi banco y activar el pago automático", "Vincular meu banco e ativar o pagamento automático", "Lier ma banque et activer le paiement automatique", "Konekte bank mwen epi limen peman otomatik"],
  "Bank account": ["Cuenta bancaria", "Conta bancária", "Compte bancaire", "Kont labank"],
  "{amount} fee": ["Cargo de {amount}", "Taxa de {amount}", "Frais de {amount}", "Frè {amount}"],
  "No fee": ["Sin cargo", "Sem taxa", "Sans frais", "San frè"],
  "on {amount}": ["sobre {amount}", "sobre {amount}", "sur {amount}", "sou {amount}"],
  "{amount} less than card": ["{amount} menos que con tarjeta", "{amount} a menos que no cartão", "{amount} de moins que par carte", "{amount} mwens pase ak kat"],
  "clears in 3–5 business days": ["se acredita en 3 a 5 días hábiles", "compensa em 3 a 5 dias úteis", "réglé d'ici 3 à 5 jours ouvrables", "l ap pase nan 3 a 5 jou ouvrab"],
  "charged instantly": ["se cobra al instante", "cobrado na hora", "débité instantanément", "chaje touswit"],
  "Bank autopay is then turned off.": ["En ese caso, el pago automático bancario se desactiva.", "Nesse caso, o pagamento automático bancário é desativado.", "Le paiement automatique bancaire est alors désactivé.", "Lè sa a, peman otomatik labank lan etenn."],
  "Bank autopay was not turned on.": ["El pago automático bancario no se activó.", "O pagamento automático bancário não foi ativado.", "Le paiement automatique bancaire n'a pas été activé.", "Peman otomatik labank lan pa t limen."],
  "Autopay is on with your bank account ending in {last4}.": ["El pago automático está activado con su cuenta bancaria terminada en {last4}.", "O pagamento automático está ativado com sua conta bancária com final {last4}.", "Le paiement automatique est activé avec votre compte bancaire se terminant par {last4}.", "Peman otomatik limen ak kont labank ou ki fini ak {last4}."],
  "Could not save the bank account.": ["No se pudo guardar la cuenta bancaria.", "Não foi possível salvar a conta bancária.", "Impossible d'enregistrer le compte bancaire.", "Nou pa t kapab anrejistre kont labank lan."],
  "Could not save the bank account. Please try again.": ["No se pudo guardar la cuenta bancaria. Inténtelo de nuevo.", "Não foi possível salvar a conta bancária. Tente novamente.", "Impossible d'enregistrer le compte bancaire. Veuillez réessayer.", "Nou pa t kapab anrejistre kont labank lan. Tanpri eseye ankò."],
  "Autopay is on": ["El pago automático está activado", "O pagamento automático está ativado", "Le paiement automatique est activé", "Peman otomatik limen"],
  "Bank account ending in {last4} — your balance is paid from your bank automatically each month (clears in 3–5 business days).": ["Cuenta bancaria terminada en {last4} — su saldo se paga automáticamente desde su banco cada mes (se acredita en 3 a 5 días hábiles).", "Conta bancária com final {last4} — seu saldo é pago automaticamente pelo seu banco todo mês (compensa em 3 a 5 dias úteis).", "Compte bancaire se terminant par {last4} — votre solde est prélevé automatiquement de votre banque chaque mois (réglé d'ici 3 à 5 jours ouvrables).", "Kont labank ki fini ak {last4} — balans ou peye otomatikman nan bank ou chak mwa (li pase nan 3 a 5 jou ouvrab)."],
  "Card ending in {last4}": ["Tarjeta terminada en {last4}", "Cartão com final {last4}", "Carte se terminant par {last4}", "Kat ki fini ak {last4}"],
  "Card on file": ["Tarjeta registrada", "Cartão cadastrado", "Carte au dossier", "Kat ki anrejistre"],
  "Saved payment method": ["Forma de pago guardada", "Forma de pagamento salva", "Mode de paiement enregistré", "Mwayen peman ki anrejistre"],
  "{method} — your balance will be charged automatically each month.": ["{method} — su saldo se cobrará automáticamente cada mes.", "{method} — seu saldo será cobrado automaticamente todo mês.", "{method} — votre solde sera débité automatiquement chaque mois.", "{method} — balans ou ap chaje otomatikman chak mwa."],
  "The park has paused bank payments, so autopay will not take payments from your bank until they are turned back on. Please pay your balance yourself meanwhile, or turn off autopay and set it up with a card.": ["El parque pausó los pagos bancarios, así que el pago automático no cobrará de su banco hasta que se vuelvan a activar. Mientras tanto, pague su saldo usted mismo, o desactive el pago automático y configúrelo con una tarjeta.", "O parque pausou os pagamentos bancários, então o pagamento automático não vai debitar do seu banco até que sejam reativados. Enquanto isso, pague seu saldo por conta própria, ou desative o pagamento automático e configure com um cartão.", "Le parc a suspendu les paiements bancaires; le paiement automatique ne prélèvera donc rien de votre banque tant qu'ils ne seront pas réactivés. D'ici là, veuillez payer votre solde vous-même, ou désactivez le paiement automatique et configurez-le avec une carte.", "Pak la mete peman labank yo an poz, kidonk peman otomatik la p ap retire lajan nan bank ou jiskaske yo limen l ankò. Pandan tan sa a, tanpri peye balans ou oumenm, oswa etenn peman otomatik la epi mete l ak yon kat."],
  "Bank debit authorization accepted on {date}.": ["Autorización de débito bancario aceptada el {date}.", "Autorização de débito bancário aceita em {date}.", "Autorisation de prélèvement bancaire acceptée le {date}.", "Otorizasyon pou retire lajan nan bank aksepte {date}."],
  "Recurring charge authorization accepted on {date}.": ["Autorización de cobro recurrente aceptada el {date}.", "Autorização de cobrança recorrente aceita em {date}.", "Autorisation de paiements récurrents acceptée le {date}.", "Otorizasyon pou peman ki repete aksepte {date}."],
  "Switch autopay to your bank account": ["Cambiar el pago automático a su cuenta bancaria", "Mudar o pagamento automático para sua conta bancária", "Passer au paiement automatique par votre compte bancaire", "Chanje peman otomatik la pou kont labank ou"],
  "Pay less with your bank.": ["Pague menos con su banco.", "Pague menos com seu banco.", "Payez moins avec votre banque.", "Peye mwens ak bank ou."],
  "On {amount} the fee is {ach} by bank vs {card} by card.": ["Sobre {amount}, el cargo es {ach} con banco frente a {card} con tarjeta.", "Sobre {amount}, a taxa é {ach} no banco contra {card} no cartão.", "Sur {amount}, les frais sont de {ach} par banque contre {card} par carte.", "Sou {amount}, frè a se {ach} ak bank kont {card} ak kat."],
  "Bank autopay is available.": ["El pago automático bancario está disponible.", "O pagamento automático bancário está disponível.", "Le paiement automatique bancaire est offert.", "Peman otomatik labank disponib."],
  "Switch to bank autopay": ["Cambiar a pago automático bancario", "Mudar para pagamento automático bancário", "Passer au paiement automatique bancaire", "Chanje pou peman otomatik labank"],
  "Turning off...": ["Desactivando...", "Desativando...", "Désactivation...", "Ap etenn..."],
  "Turn Off Autopay": ["Desactivar pago automático", "Desativar pagamento automático", "Désactiver le paiement automatique", "Etenn peman otomatik"],

  // ---- BankPayBanner ----
  "New: pay by bank": ["Nuevo: pague con su banco", "Novidade: pague com seu banco", "Nouveau : payez par banque", "Nouvo: peye ak bank"],
  "🏦 New: pay by bank — lower fee than card": ["🏦 Nuevo: pague con su banco — cargo más bajo que con tarjeta", "🏦 Novidade: pague com seu banco — taxa menor que no cartão", "🏦 Nouveau : payez par banque — frais plus bas que par carte", "🏦 Nouvo: peye ak bank — frè pi ba pase ak kat"],
  "You can now pay straight from your checking or savings account.": ["Ahora puede pagar directamente desde su cuenta corriente o de ahorros.", "Agora você pode pagar direto da sua conta corrente ou poupança.", "Vous pouvez maintenant payer directement à partir de votre compte chèques ou épargne.", "Kounye a ou ka peye dirèkteman nan kont chèk oswa kont epay ou."],
  "On {amount} the fee is {ach} by bank instead of {card} by card.": ["Sobre {amount}, el cargo es {ach} con banco en lugar de {card} con tarjeta.", "Sobre {amount}, a taxa é {ach} no banco em vez de {card} no cartão.", "Sur {amount}, les frais sont de {ach} par banque au lieu de {card} par carte.", "Sou {amount}, frè a se {ach} ak bank olye {card} ak kat."],
  "The bank fee is {achPct}% (at most {achMax}), the card fee {cardPct}%.": ["El cargo bancario es {achPct}% (como máximo {achMax}); el de tarjeta, {cardPct}%.", "A taxa bancária é {achPct}% (no máximo {achMax}); a do cartão, {cardPct}%.", "Les frais bancaires sont de {achPct} % (au plus {achMax}), les frais de carte de {cardPct} %.", "Frè bank lan se {achPct}% (pa plis pase {achMax}), frè kat la {cardPct}%."],
  "No fee either way.": ["Sin cargo en ningún caso.", "Sem taxa em nenhum dos casos.", "Aucuns frais dans les deux cas.", "Pa gen frè ni pou youn ni pou lòt."],
  "Bank payments take 3–5 business days to clear.": ["Los pagos bancarios tardan de 3 a 5 días hábiles en acreditarse.", "Os pagamentos bancários levam de 3 a 5 dias úteis para compensar.", "Les paiements bancaires prennent de 3 à 5 jours ouvrables à être réglés.", "Peman labank pran 3 a 5 jou ouvrab pou yo pase."],
  "Pay by bank": ["Pagar con banco", "Pagar com banco", "Payer par banque", "Peye ak bank"],
  "Set up bank autopay": ["Configurar pago automático bancario", "Configurar pagamento automático bancário", "Configurer le paiement automatique bancaire", "Mete peman otomatik labank"],

  // ---- ParkInfo ----
  "Call {phone}": ["Llamar al {phone}", "Ligar para {phone}", "Appeler le {phone}", "Rele {phone}"],
  "Open now": ["Abierto ahora", "Aberto agora", "Ouvert maintenant", "Louvri kounye a"],
  "Closed now": ["Cerrado ahora", "Fechado agora", "Fermé maintenant", "Fèmen kounye a"],
  "Call the office for current office hours.": ["Llame a la oficina para conocer el horario actual.", "Ligue para o escritório para saber o horário atual.", "Appelez le bureau pour connaître les heures d'ouverture.", "Rele biwo a pou konnen lè li ouvè."],
  "Call the office for current office hours at {phone}.": ["Llame a la oficina al {phone} para conocer el horario actual.", "Ligue para o escritório no {phone} para saber o horário atual.", "Appelez le bureau au {phone} pour connaître les heures d'ouverture.", "Rele biwo a nan {phone} pou konnen lè li ouvè."],
  " (today)": [" (hoy)", " (hoje)", " (aujourd'hui)", " (jodi a)"],
  "Closed": ["Cerrado", "Fechado", "Fermé", "Fèmen"],
  "Eastern Time": ["Hora del Este", "Horário do Leste (EUA)", "Heure de l'Est", "Lè Lès (Eastern)"],
  "Call 911": ["Llamar al 911", "Ligar para o 911", "Composer le 911", "Rele 911"],
  "Park info could not be loaded. Please try again later.": ["No se pudo cargar la información del parque. Inténtelo más tarde.", "Não foi possível carregar as informações do parque. Tente mais tarde.", "Impossible de charger les infos du parc. Veuillez réessayer plus tard.", "Nou pa t kapab chaje enfò sou pak la. Tanpri eseye ankò pita."],
  "For anything life-threatening, call 911 before anything else. Then also notify the park": ["Ante cualquier peligro para la vida, llame primero al 911. Después avise también al parque", "Em qualquer situação de risco à vida, ligue primeiro para o 911. Depois avise também o parque", "Si une vie est en danger, composez le 911 avant toute chose. Avisez ensuite aussi le parc", "Pou nenpòt bagay ki mete lavi an danje, rele 911 anvan tout bagay. Apre sa, avèti pak la tou"],
  " at ": [" al ", " no ", " au ", " nan "],
  " so staff can meet responders and guide them to your site.": [" para que el personal reciba a los servicios de emergencia y los guíe hasta su lote.", " para que a equipe receba o socorro e o guie até o seu lote.", " pour que le personnel puisse accueillir les secours et les guider jusqu'à votre terrain.", " pou anplwaye yo ka resevwa sekou yo epi mennen yo nan espas ou."],
  "Call the park's emergency line": ["Llame a la línea de emergencia del parque", "Ligue para a linha de emergência do parque", "Appelez la ligne d'urgence du parc", "Rele liy ijans pak la"],
  "For urgent problems at your site that are not life-threatening.": ["Para problemas urgentes en su lote que no ponen en peligro la vida.", "Para problemas urgentes no seu lote que não representam risco à vida.", "Pour les problèmes urgents à votre terrain qui ne mettent pas de vie en danger.", "Pou pwoblèm ijan nan espas ou ki pa mete lavi an danje."],
  " This is the office number.": [" Es el número de la oficina.", " É o número do escritório.", " C'est le numéro du bureau.", " Se nimewo biwo a."],
  "Office:": ["Oficina:", "Escritório:", "Bureau :", "Biwo:"],
  "Call the office": ["Llamar a la oficina", "Ligar para o escritório", "Appeler le bureau", "Rele biwo a"],
  "After hours:": ["Fuera de horario:", "Fora do horário:", "Hors des heures d'ouverture :", "Apre lè biwo:"],
  "Real emergencies are covered above.": ["Las emergencias reales están explicadas arriba.", "As emergências reais estão explicadas acima.", "Les vraies urgences sont traitées ci-dessus.", "Vrè ijans yo eksplike anlè a."],
  "Emergency & office hours": ["Emergencias y horario de oficina", "Emergências e horário do escritório", "Urgences et heures du bureau", "Ijans ak lè biwo a ouvè"],
  "Today:": ["Hoy:", "Hoje:", "Aujourd'hui :", "Jodi a:"],
  "Call the office for office hours.": ["Llame a la oficina para conocer el horario.", "Ligue para o escritório para saber o horário.", "Appelez le bureau pour connaître les heures d'ouverture.", "Rele biwo a pou konnen lè li ouvè."],
  "Fire, medical, crime or a strong gas smell: call 911 first.": ["Incendio, emergencia médica, delito o fuerte olor a gas: llame primero al 911.", "Incêndio, emergência médica, crime ou forte cheiro de gás: ligue primeiro para o 911.", "Incendie, urgence médicale, crime ou forte odeur de gaz : composez d'abord le 911.", "Dife, ijans medikal, krim oswa yon gwo odè gaz: rele 911 anvan."],
  "What to do & park rules →": ["Qué hacer y reglas del parque →", "O que fazer e regras do parque →", "Que faire et règlements du parc →", "Sa pou fè ak règleman pak la →"],

  "Non-emergency calls after office hours have a {fee} inconvenience fee.": ["Las llamadas que no son emergencias fuera del horario de oficina tienen un cargo de {fee} por la molestia.", "Ligações que não são emergência fora do horário do escritório têm uma taxa de {fee}.", "Les appels non urgents en dehors des heures d'ouverture entraînent des frais de dérangement de {fee}.", "Apèl ki pa ijans apre lè biwo gen yon frè deranjman {fee}."],
  // Standard MelyOS emergency texts (src/lib/portalInfo.ts DEFAULT_EMERGENCIES) — translated only
  // while the park hasn't changed them; a park's own wording shows as written.
  "Fire or smoke": ["Incendio o humo", "Incêndio ou fumaça", "Incendie ou fumée", "Dife oswa lafimen"],
  "Get everyone out and away from the RV or home, then call 911. Do not go back inside. Give the park's address and your lot number.": ["Saque a todos y aléjense del RV o la vivienda; luego llame al 911. No vuelva a entrar. Dé la dirección del parque y su número de lote.", "Tire todos e afaste-se do RV ou da casa; depois ligue para o 911. Não volte para dentro. Informe o endereço do parque e o número do seu lote.", "Faites sortir tout le monde et éloignez-vous du VR ou de la maison, puis composez le 911. Ne retournez pas à l'intérieur. Donnez l'adresse du parc et votre numéro de terrain.", "Fè tout moun soti epi ale lwen RV a oswa kay la, apre sa rele 911. Pa retounen anndan. Bay adrès pak la ak nimewo espas ou."],
  "Medical emergency": ["Emergencia médica", "Emergência médica", "Urgence médicale", "Ijans medikal"],
  "Someone is hurt, not breathing, has chest pain or is unconscious: call 911 right away and follow the dispatcher's instructions. Give the park's address and your lot number.": ["Si alguien está herido, no respira, tiene dolor en el pecho o está inconsciente: llame al 911 de inmediato y siga las instrucciones de la operadora. Dé la dirección del parque y su número de lote.", "Se alguém está ferido, não respira, tem dor no peito ou está inconsciente: ligue para o 911 imediatamente e siga as instruções do atendente. Informe o endereço do parque e o número do seu lote.", "Quelqu'un est blessé, ne respire pas, a des douleurs à la poitrine ou est inconscient : composez le 911 immédiatement et suivez les instructions du répartiteur. Donnez l'adresse du parc et votre numéro de terrain.", "Yon moun blese, li pa respire, li gen doulè nan lestomak oswa li pèdi konesans: rele 911 touswit epi swiv enstriksyon moun ki reponn nan. Bay adrès pak la ak nimewo espas ou."],
  "Crime in progress, violence or someone in danger": ["Delito en curso, violencia o alguien en peligro", "Crime em andamento, violência ou alguém em perigo", "Crime en cours, violence ou personne en danger", "Krim k ap fèt, vyolans oswa yon moun an danje"],
  "Get to a safe place and call 911. Do not confront anyone.": ["Vaya a un lugar seguro y llame al 911. No enfrente a nadie.", "Vá para um lugar seguro e ligue para o 911. Não confronte ninguém.", "Mettez-vous en lieu sûr et composez le 911. Ne confrontez personne.", "Ale nan yon kote ki an sekirite epi rele 911. Pa al goumen ak pèsonn."],
  "Strong gas smell or propane leak": ["Fuerte olor a gas o fuga de propano", "Forte cheiro de gás ou vazamento de propano", "Forte odeur de gaz ou fuite de propane", "Gwo odè gaz oswa pwopàn k ap koule"],
  "Leave the area first. Do not use flames, light switches, phones or anything that can spark near it. From a safe place, upwind, call 911.": ["Primero salga del área. No use fuego, interruptores de luz, teléfonos ni nada que pueda hacer chispa cerca. Desde un lugar seguro, en contra del viento, llame al 911.", "Primeiro saia da área. Não use fogo, interruptores, telefones nem nada que possa soltar faísca por perto. De um lugar seguro, contra o vento, ligue para o 911.", "Quittez d'abord les lieux. N'utilisez pas de flamme, d'interrupteur, de téléphone ni rien qui puisse faire une étincelle à proximité. D'un endroit sûr, dos au vent, composez le 911.", "Kite zòn nan anvan. Pa itilize dife, entèwiptè limyè, telefòn oswa nenpòt bagay ki ka fè etensèl toupre a. Depi yon kote ki an sekirite, kote van an pa pote gaz la, rele 911."],
  "Car accident with injuries": ["Accidente de auto con heridos", "Acidente de carro com feridos", "Accident de voiture avec blessés", "Aksidan machin ak moun ki blese"],
  "Call 911. Do not move anyone who is hurt unless they are in immediate danger.": ["Llame al 911. No mueva a ningún herido a menos que esté en peligro inmediato.", "Ligue para o 911. Não mova nenhum ferido, a não ser que esteja em perigo imediato.", "Composez le 911. Ne déplacez pas une personne blessée, sauf si elle est en danger immédiat.", "Rele 911. Pa deplase yon moun ki blese sof si li an danje touswit."],
  "Severe weather with immediate danger": ["Mal tiempo con peligro inmediato", "Tempo severo com perigo imediato", "Météo violente avec danger immédiat", "Move tan ak danje touswit"],
  "Tornado warning or water flooding inside your RV: go to a sturdy building or public shelter now — an RV is not safe shelter. Call 911 if anyone is trapped or in danger.": ["Alerta de tornado o agua inundando su RV: vaya ahora a un edificio sólido o a un refugio público — un RV no es un refugio seguro. Llame al 911 si alguien está atrapado o en peligro.", "Alerta de tornado ou água inundando seu RV: vá agora para um prédio firme ou um abrigo público — um RV não é abrigo seguro. Ligue para o 911 se alguém estiver preso ou em perigo.", "Alerte de tornade ou eau qui inonde l'intérieur de votre VR : rendez-vous maintenant dans un bâtiment solide ou un refuge public — un VR n'est pas un abri sûr. Composez le 911 si quelqu'un est coincé ou en danger.", "Alèt tònad oswa dlo k ap inonde anndan RV ou: ale kounye a nan yon bilding solid oswa yon abri piblik — yon RV pa yon abri ki an sekirite. Rele 911 si yon moun bloke oswa an danje."],
  "Downed or sparking power line": ["Cable eléctrico caído o echando chispas", "Fio elétrico caído ou soltando faíscas", "Fil électrique tombé ou qui fait des étincelles", "Fil kouran ki tonbe oswa k ap fè etensèl"],
  "Stay at least 30 feet away and keep others away. Never touch the line or anything it is touching. Call 911.": ["Manténgase a por lo menos 30 pies (9 metros) y mantenga alejados a los demás. Nunca toque el cable ni nada que esté tocando. Llame al 911.", "Fique a pelo menos 30 pés (9 metros) e mantenha os outros longe. Nunca toque no fio nem em nada que ele esteja tocando. Ligue para o 911.", "Restez à au moins 30 pieds et éloignez les autres. Ne touchez jamais le fil ni rien de ce qu'il touche. Composez le 911.", "Rete omwen 30 pye lwen epi kenbe lòt moun lwen. Pa janm manyen fil la ni anyen li manyen. Rele 911."],
  "Power out at your site": ["Sin electricidad en su lote", "Sem energia no seu lote", "Panne de courant à votre terrain", "Pa gen kouran nan espas ou"],
  "Check whether your neighbors also lost power. If only your site is out, reset the breaker on your pedestal and your RV's main breaker. If that does not fix it, call the park's emergency line. If the whole park is out, staff are already working on it.": ["Fíjese si sus vecinos también se quedaron sin luz. Si solo es su lote, reinicie el breaker de su pedestal y el breaker principal de su RV. Si eso no lo resuelve, llame a la línea de emergencia del parque. Si todo el parque está sin luz, el personal ya está trabajando en ello.", "Veja se os vizinhos também ficaram sem energia. Se for só o seu lote, religue o disjuntor do seu pedestal e o disjuntor principal do seu RV. Se não resolver, ligue para a linha de emergência do parque. Se o parque inteiro estiver sem energia, a equipe já está cuidando disso.", "Vérifiez si vos voisins ont aussi perdu le courant. Si seul votre terrain est touché, réenclenchez le disjoncteur de votre borne et le disjoncteur principal de votre VR. Si cela ne règle pas le problème, appelez la ligne d'urgence du parc. Si tout le parc est en panne, le personnel s'en occupe déjà.", "Gade si vwazen ou yo pèdi kouran tou. Si se sèlman espas ou ki pa gen kouran, remete brekè sou pòt kouran espas ou a ak brekè prensipal RV ou. Si sa pa regle l, rele liy ijans pak la. Si tout pak la pa gen kouran, anplwaye yo deja ap travay sou sa."],
  "No water or a water leak": ["Sin agua o con una fuga de agua", "Sem água ou com vazamento de água", "Pas d'eau ou fuite d'eau", "Pa gen dlo oswa dlo k ap koule"],
  "Check that your spigot valve is open and your hose is not kinked. If water is gushing or leaking from a park line, call the park's emergency line right away. If the whole park is out, staff are already working on it.": ["Revise que la llave de su toma esté abierta y que la manguera no esté doblada. Si sale mucha agua o hay una fuga en una tubería del parque, llame de inmediato a la línea de emergencia del parque. Si todo el parque está sin agua, el personal ya está trabajando en ello.", "Verifique se o registro da sua torneira está aberto e se a mangueira não está dobrada. Se a água estiver jorrando ou vazando de uma tubulação do parque, ligue imediatamente para a linha de emergência do parque. Se o parque inteiro estiver sem água, a equipe já está cuidando disso.", "Vérifiez que le robinet est ouvert et que votre boyau n'est pas plié. Si l'eau jaillit ou fuit d'une conduite du parc, appelez immédiatement la ligne d'urgence du parc. Si tout le parc est sans eau, le personnel s'en occupe déjà.", "Gade si tiyo robinè a louvri epi kawotchou a pa ploye. Si dlo ap pete oswa ap koule nan yon tiyo pak la, rele liy ijans pak la touswit. Si tout pak la pa gen dlo, anplwaye yo deja ap travay sou sa."],
  "Sewer or plumbing backup": ["Desagüe o tubería tapada", "Esgoto ou encanamento entupido", "Refoulement d'égout ou de plomberie", "Egou oswa tiyo ki bouche"],
  "Stop using water and do not flush. Close the water at your spigot. If sewage is coming out of the park's sewer connection or flooding your site, call the park's emergency line. A clog inside your RV or home is the resident's responsibility.": ["Deje de usar agua y no descargue el inodoro. Cierre el agua en su toma. Si sale agua negra de la conexión de desagüe del parque o se inunda su lote, llame a la línea de emergencia del parque. Una obstrucción dentro de su RV o vivienda es responsabilidad del residente.", "Pare de usar água e não dê descarga. Feche a água na sua torneira. Se o esgoto estiver saindo pela ligação de esgoto do parque ou alagando seu lote, ligue para a linha de emergência do parque. Um entupimento dentro do seu RV ou casa é responsabilidade do morador.", "Cessez d'utiliser l'eau et ne tirez pas la chasse. Fermez l'eau au robinet. Si des eaux usées sortent du raccord d'égout du parc ou inondent votre terrain, appelez la ligne d'urgence du parc. Un bouchon à l'intérieur de votre VR ou de votre maison est la responsabilité du résident.", "Sispann sèvi ak dlo epi pa rale chas twalèt la. Fèmen dlo a nan robinè a. Si dlo egou ap soti nan koneksyon egou pak la oswa ap inonde espas ou, rele liy ijans pak la. Yon bouchon anndan RV oswa kay ou se responsablite rezidan an."],
  "Small propane issue (no smell of danger)": ["Problema menor con el propano (sin olor peligroso)", "Problema pequeno com o propano (sem cheiro de perigo)", "Petit problème de propane (aucune odeur inquiétante)", "Ti pwoblèm pwopàn (pa gen odè ki danjere)"],
  "Close the tank valve and do not use the appliance. Call the park's emergency line. If you smell gas strongly, leave the area and call 911 instead.": ["Cierre la válvula del tanque y no use el aparato. Llame a la línea de emergencia del parque. Si huele mucho a gas, salga del área y llame al 911.", "Feche a válvula do botijão e não use o aparelho. Ligue para a linha de emergência do parque. Se sentir cheiro forte de gás, saia da área e ligue para o 911.", "Fermez la valve de la bonbonne et n'utilisez pas l'appareil. Appelez la ligne d'urgence du parc. Si vous sentez une forte odeur de gaz, quittez plutôt les lieux et composez le 911.", "Fèmen valv tank lan epi pa sèvi ak aparèy la. Rele liy ijans pak la. Si ou santi yon gwo odè gaz, kite zòn nan epi rele 911 pito."],
  "Fallen tree or storm damage": ["Árbol caído o daños por tormenta", "Árvore caída ou estragos da tempestade", "Arbre tombé ou dommages causés par une tempête", "Pyebwa ki tonbe oswa domaj tanpèt"],
  "Stay clear of the damage and of any wires. Call the park's emergency line. If a wire is down or anyone is hurt, call 911 first.": ["Manténgase lejos de los daños y de cualquier cable. Llame a la línea de emergencia del parque. Si hay un cable caído o alguien herido, llame primero al 911.", "Fique longe dos estragos e de qualquer fio. Ligue para a linha de emergência do parque. Se houver fio caído ou alguém ferido, ligue primeiro para o 911.", "Tenez-vous loin des dommages et de tout fil. Appelez la ligne d'urgence du parc. Si un fil est tombé ou si quelqu'un est blessé, composez d'abord le 911.", "Rete lwen domaj la ak nenpòt fil. Rele liy ijans pak la. Si yon fil tonbe oswa yon moun blese, rele 911 anvan."],
  "Locked out": ["Se quedó afuera sin llave", "Ficou trancado do lado de fora", "Enfermé dehors", "Ou bloke deyò san kle"],
  "Call the park's emergency line. Staff may not be able to open your RV or home, but can help you find a locksmith.": ["Llame a la línea de emergencia del parque. Es posible que el personal no pueda abrir su RV o vivienda, pero puede ayudarle a encontrar un cerrajero.", "Ligue para a linha de emergência do parque. A equipe talvez não consiga abrir seu RV ou casa, mas pode ajudar a encontrar um chaveiro.", "Appelez la ligne d'urgence du parc. Le personnel ne pourra peut-être pas ouvrir votre VR ou votre maison, mais peut vous aider à trouver un serrurier.", "Rele liy ijans pak la. Anplwaye yo ka pa kapab louvri RV oswa kay ou, men yo ka ede w jwenn yon seriye."],
  "Hurricane or tropical storm coming": ["Se acerca un huracán o tormenta tropical", "Furacão ou tempestade tropical se aproximando", "Ouragan ou tempête tropicale à venir", "Siklòn oswa tanpèt twopikal k ap vini"],
  "Follow official alerts from local emergency management and the National Weather Service. Secure or bring in awnings, chairs, grills and anything that can blow away. Know your evacuation route and leave when an evacuation order is issued. Call the park's emergency line for park-related questions.": ["Siga las alertas oficiales de manejo de emergencias local y del Servicio Nacional de Meteorología. Asegure o guarde toldos, sillas, parrillas y todo lo que el viento pueda llevarse. Conozca su ruta de evacuación y salga cuando se emita una orden de evacuación. Para preguntas sobre el parque, llame a la línea de emergencia del parque.", "Acompanhe os alertas oficiais da defesa civil local e do Serviço Nacional de Meteorologia (NWS). Prenda ou guarde toldos, cadeiras, churrasqueiras e tudo o que o vento possa levar. Conheça sua rota de evacuação e saia quando houver ordem de evacuação. Para dúvidas sobre o parque, ligue para a linha de emergência do parque.", "Suivez les alertes officielles de la gestion locale des urgences et du National Weather Service. Attachez ou rentrez les auvents, chaises, barbecues et tout ce qui peut s'envoler. Connaissez votre trajet d'évacuation et partez dès qu'un ordre d'évacuation est donné. Appelez la ligne d'urgence du parc pour les questions liées au parc.", "Swiv alèt ofisyèl sèvis ijans lokal la ak National Weather Service. Mare oswa rantre tant, chèz, griy ak tout sa van ka pote ale. Konnen wout evakyasyon ou epi pati lè yo bay lòd evakyasyon. Rele liy ijans pak la pou kesyon sou pak la."],

  // ---- LeaseAddendaCard ----
  "Could not open the signed copy.": ["No se pudo abrir la copia firmada.", "Não foi possível abrir a cópia assinada.", "Impossible d'ouvrir la copie signée.", "Nou pa t kapab louvri kopi siyen an."],
  "Could not sign. Please try again.": ["No se pudo firmar. Inténtelo de nuevo.", "Não foi possível assinar. Tente novamente.", "Impossible de signer. Veuillez réessayer.", "Nou pa t kapab siyen. Tanpri eseye ankò."],
  "Signed. Thank you!": ["Firmado. ¡Gracias!", "Assinado. Obrigado!", "Signé. Merci!", "Siyen. Mèsi!"],
  "Download signed copy": ["Descargar copia firmada", "Baixar cópia assinada", "Télécharger la copie signée", "Telechaje kopi siyen an"],
  "Action needed": ["Acción requerida", "Ação necessária", "Action requise", "Ou bezwen fè yon bagay"],
  "Please review and sign: {title}": ["Revise y firme, por favor: {title}", "Revise e assine, por favor: {title}", "Veuillez lire et signer : {title}", "Tanpri li epi siyen: {title}"],
  "{park} sent you a short agreement that puts in writing the park's rule for returned payments{lot}. Everything else about your rental stays the same. Sent {date}.": ["{park} le envió un acuerdo corto que deja por escrito la regla del parque sobre pagos devueltos{lot}. Todo lo demás de su alquiler sigue igual. Enviado el {date}.", "{park} enviou um acordo curto que coloca por escrito a regra do parque sobre pagamentos devolvidos{lot}. Todo o resto do seu aluguel continua igual. Enviado em {date}.", "{park} vous a envoyé une courte entente qui met par écrit la règle du parc sur les paiements retournés{lot}. Tout le reste de votre location demeure inchangé. Envoyée le {date}.", "{park} voye yon ti akò ba ou ki mete règ pak la sou peman ki retounen yo sou papye{lot}. Tout lòt bagay nan lwaye ou rete menm jan. Voye {date}."],
  " for Lot {name}": [" para el lote {name}", " para o lote {name}", " pour le terrain {name}", " pou espas {name}"],
  "Review and sign": ["Revisar y firmar", "Revisar e assinar", "Lire et signer", "Li epi siyen"],
  "<b>I have read and agree</b> to this Resident Agreement, and I adopt the signature below and agree to sign electronically.": ["<b>He leído y acepto</b> este Acuerdo de Residente, adopto la firma de abajo y acepto firmar electrónicamente.", "<b>Li e aceito</b> este Acordo de Morador, adoto a assinatura abaixo e concordo em assinar eletronicamente.", "<b>J'ai lu et j'accepte</b> cette entente de résident, j'adopte la signature ci-dessous et j'accepte de signer électroniquement.", "<b>Mwen li epi mwen dakò</b> ak Akò Rezidan sa a, mwen pran siyati ki anba a kòm pa m epi mwen dakò siyen sou entènèt."],
  "Type your full name to sign": ["Escriba su nombre completo para firmar", "Digite seu nome completo para assinar", "Tapez votre nom complet pour signer", "Tape non konplè ou pou siyen"],
  "Your signature": ["Su firma", "Sua assinatura", "Votre signature", "Siyati ou"],
  "By checking the box and pressing <b>Sign agreement</b>, I agree that the signature shown above, together with my typed name, is my electronic signature on this agreement, the same as a pen-and-paper signature. I consent to receive this agreement and related notices electronically, and I understand I can download a signed copy from Documents. My name, the date and time, my IP address and device are recorded with my signature.": ["Al marcar la casilla y presionar <b>Firmar acuerdo</b>, acepto que la firma que aparece arriba, junto con mi nombre escrito, es mi firma electrónica en este acuerdo, igual que una firma en papel. Acepto recibir este acuerdo y los avisos relacionados de forma electrónica, y entiendo que puedo descargar una copia firmada en Documentos. Con mi firma se registran mi nombre, la fecha y la hora, mi dirección IP y mi dispositivo.", "Ao marcar a caixa e tocar em <b>Assinar acordo</b>, concordo que a assinatura mostrada acima, junto com meu nome digitado, é a minha assinatura eletrônica neste acordo, igual a uma assinatura no papel. Aceito receber este acordo e os avisos relacionados de forma eletrônica, e entendo que posso baixar uma cópia assinada em Documentos. Meu nome, a data e a hora, meu endereço IP e meu dispositivo são registrados com a minha assinatura.", "En cochant la case et en appuyant sur <b>Signer l'entente</b>, j'accepte que la signature ci-dessus, avec mon nom tapé, constitue ma signature électronique de cette entente, au même titre qu'une signature à la main sur papier. Je consens à recevoir cette entente et les avis connexes par voie électronique, et je comprends que je peux télécharger une copie signée dans Documents. Mon nom, la date et l'heure, mon adresse IP et mon appareil sont enregistrés avec ma signature.", "Lè m tcheke bwat la epi m peze <b>Siyen akò a</b>, mwen dakò siyati ki parèt anlè a, ansanm ak non m tape a, se siyati elektwonik mwen sou akò sa a, menm jan ak yon siyati ak plim sou papye. Mwen dakò resevwa akò sa a ak avi ki gen rapò avè l pa vwa elektwonik, epi mwen konprann mwen ka telechaje yon kopi siyen nan Dokiman. Non m, dat ak lè a, adrès IP mwen ak aparèy mwen anrejistre ansanm ak siyati m."],
  "Not now": ["Ahora no", "Agora não", "Pas maintenant", "Pa kounye a"],
  "Signing…": ["Firmando…", "Assinando…", "Signature…", "Ap siyen…"],
  "Sign agreement": ["Firmar acuerdo", "Assinar acordo", "Signer l'entente", "Siyen akò a"],

  // ---- ViewAsBanner / view-as ready ----
  "Viewing as {name} — read only. Nothing can be paid, signed or changed.": ["Viendo como {name} — solo lectura. No se puede pagar, firmar ni cambiar nada.", "Visualizando como {name} — somente leitura. Nada pode ser pago, assinado ou alterado.", "Affichage en tant que {name} — lecture seule. Rien ne peut être payé, signé ni modifié.", "W ap gade tankou {name} — li sèlman. Ou pa ka peye, siyen ni chanje anyen."],
  "Viewing as {name} — read only": ["Viendo como {name} — solo lectura", "Visualizando como {name} — somente leitura", "Affichage en tant que {name} — lecture seule", "W ap gade tankou {name} — li sèlman"],
  "Nothing can be paid, signed or changed.": ["No se puede pagar, firmar ni cambiar nada.", "Nada pode ser pago, assinado ou alterado.", "Rien ne peut être payé, signé ni modifié.", "Ou pa ka peye, siyen ni chanje anyen."],
  "Exiting…": ["Saliendo…", "Saindo…", "Sortie…", "Ap soti…"],
  "Exit": ["Salir", "Sair", "Quitter", "Soti"],
  "This link is invalid, expired or was already used. Open it again from the admin.": ["Este enlace no es válido, venció o ya se usó. Ábralo de nuevo desde la administración.", "Este link é inválido, expirou ou já foi usado. Abra de novo pela administração.", "Ce lien est invalide, expiré ou a déjà été utilisé. Ouvrez-le de nouveau à partir de l'administration.", "Lyen sa a pa bon, li ekspire oswa yo deja sèvi avè l. Louvri l ankò depi nan administrasyon an."],
  "This link only works on the park's own website.": ["Este enlace solo funciona en el sitio web del parque.", "Este link só funciona no site do próprio parque.", "Ce lien fonctionne seulement sur le site Web du parc.", "Lyen sa a mache sèlman sou sit entènèt pak la."],
  "You are no longer allowed to view this resident's portal.": ["Ya no tiene permiso para ver el portal de este residente.", "Você não tem mais permissão para ver o portal deste morador.", "Vous n'avez plus l'autorisation de consulter le portail de ce résident.", "Ou pa gen dwa gade pòtay rezidan sa a ankò."],
  "This view has ended. Open it again from the admin.": ["Esta vista terminó. Ábrala de nuevo desde la administración.", "Esta visualização terminou. Abra de novo pela administração.", "Cet affichage est terminé. Ouvrez-le de nouveau à partir de l'administration.", "Vizyon sa a fini. Louvri l ankò depi nan administrasyon an."],
  "Could not open the resident portal. Please try again.": ["No se pudo abrir el portal de residentes. Inténtelo de nuevo.", "Não foi possível abrir o portal do morador. Tente novamente.", "Impossible d'ouvrir le portail des résidents. Veuillez réessayer.", "Nou pa t kapab louvri pòtay rezidan an. Tanpri eseye ankò."],
  "View as resident": ["Ver como residente", "Ver como morador", "Voir en tant que résident", "Gade tankou rezidan"],
  "Park staff only": ["Solo para el personal del parque", "Somente para a equipe do parque", "Personnel du parc seulement", "Pou anplwaye pak la sèlman"],
  "Read-only view": ["Vista de solo lectura", "Visualização somente leitura", "Affichage en lecture seule", "Vizyon li sèlman"],
  "You are about to see {name}'s portal exactly as they see it. Nothing can be paid, signed or changed.": ["Va a ver el portal de {name} tal como lo ve el residente. No se puede pagar, firmar ni cambiar nada.", "Você vai ver o portal de {name} exatamente como o residente vê. Nada pode ser pago, assinado ou alterado.", "Vous allez voir le portail de {name} exactement comme il ou elle le voit. Rien ne peut être payé, signé ni modifié.", "Ou pral wè pòtay {name} egzakteman jan li wè l. Ou pa ka peye, siyen ni chanje anyen."],
  "You are opening {name}'s portal as park staff, read only. Nothing can be paid, signed or changed.": ["Está abriendo el portal de {name} como personal del parque, en modo de solo lectura. No se puede pagar, firmar ni cambiar nada.", "Você está abrindo o portal de {name} como equipe do parque, somente leitura. Nada pode ser pago, assinado ou alterado.", "Vous ouvrez le portail de {name} en tant que membre du personnel du parc, en lecture seule. Rien ne peut être payé, signé ni modifié.", "W ap louvri pòtay {name} kòm anplwaye pak la, li sèlman. Ou pa ka peye, siyen ni chanje anyen."],
  "this resident": ["este residente", "este morador", "ce résident", "rezidan sa a"],
  "I'm not park staff": ["No soy personal del parque", "Não sou da equipe do parque", "Je ne fais pas partie du personnel du parc", "Mwen pa anplwaye pak la"],
  "Open read-only view": ["Abrir en solo lectura", "Abrir somente leitura", "Ouvrir en lecture seule", "Louvri li sèlman"],
  "Opening the resident portal (read only)…": ["Abriendo el portal de residentes (solo lectura)…", "Abrindo o portal do morador (somente leitura)…", "Ouverture du portail des résidents (lecture seule)…", "N ap louvri pòtay rezidan an (li sèlman)…"],

  // ---- SmsAlertsToggle ----
  "Could not save.": ["No se pudo guardar.", "Não foi possível salvar.", "Impossible d'enregistrer.", "Nou pa t kapab anrejistre."],
  "Text message alerts are on.": ["Las alertas por mensaje de texto están activadas.", "Os alertas por SMS estão ativados.", "Les alertes par texto sont activées.", "Alèt pa mesaj tèks limen."],
  "Text message alerts are off.": ["Las alertas por mensaje de texto están desactivadas.", "Os alertas por SMS estão desativados.", "Les alertes par texto sont désactivées.", "Alèt pa mesaj tèks etenn."],
  "Text message alerts:": ["Alertas por mensaje de texto:", "Alertas por SMS:", "Alertes par texto :", "Alèt pa mesaj tèks:"],
  "On": ["Activadas", "Ativados", "Activées", "Limen"],
  "Off": ["Desactivadas", "Desativados", "Désactivées", "Etenn"],
  "Turn off": ["Desactivar", "Desativar", "Désactiver", "Etenn"],
  "Add your mobile number above to get text alerts.": ["Agregue su número de celular arriba para recibir alertas por texto.", "Adicione seu número de celular acima para receber alertas por SMS.", "Ajoutez votre numéro de cellulaire ci-dessus pour recevoir des alertes par texto.", "Ajoute nimewo selilè ou anlè a pou w resevwa alèt pa tèks."],
  "Turn on text alerts": ["Activar alertas por texto", "Ativar alertas por SMS", "Activer les alertes par texto", "Limen alèt pa tèks"],

  // ---- InstallApp ----
  "Get the {name} app": ["Obtenga la app de {name}", "Baixe o app de {name}", "Obtenez l'appli de {name}", "Pran aplikasyon {name} an"],
  "Open your account in one tap from your home screen, with alerts on the icon.": ["Abra su cuenta con un toque desde la pantalla de inicio, con avisos en el ícono.", "Abra sua conta com um toque na tela inicial, com avisos no ícone.", "Ouvrez votre compte en un seul toucher à partir de votre écran d'accueil, avec les alertes sur l'icône.", "Louvri kont ou ak yon sèl touche depi sou ekran akèy ou, ak alèt yo sou ikòn nan."],
  "In Safari, tap <b>Share</b> {icon} then <b>Add to Home Screen</b>.": ["En Safari, toque <b>Compartir</b> {icon} y luego <b>Agregar a pantalla de inicio</b>.", "No Safari, toque em <b>Compartilhar</b> {icon} e depois em <b>Adicionar à Tela de Início</b>.", "Dans Safari, touchez <b>Partager</b> {icon}, puis <b>Sur l'écran d'accueil</b>.", "Nan Safari, touche <b>Share</b> {icon} epi <b>Add to Home Screen</b>."],
  "Install": ["Instalar", "Instalar", "Installer", "Enstale"],
  "Share icon": ["Ícono de compartir", "Ícone de compartilhar", "Icône Partager", "Ikòn Share"],

  // ---- ResidentPushAlerts ----
  "Alerts are not ready yet.": ["Las alertas aún no están listas.", "Os alertas ainda não estão prontos.", "Les alertes ne sont pas encore prêtes.", "Alèt yo poko pare."],
  "Alerts are on for this device.": ["Las alertas están activadas en este dispositivo.", "Os alertas estão ativados neste dispositivo.", "Les alertes sont activées sur cet appareil.", "Alèt yo limen sou aparèy sa a."],
  "Could not turn on alerts.": ["No se pudieron activar las alertas.", "Não foi possível ativar os alertas.", "Impossible d'activer les alertes.", "Nou pa t kapab limen alèt yo."],
  "📲 To get alerts on iPhone/iPad: tap Share → \"Add to Home Screen\", then open the app from your Home Screen.": ["📲 Para recibir alertas en iPhone/iPad: toque Compartir → \"Agregar a pantalla de inicio\" y luego abra la app desde su pantalla de inicio.", "📲 Para receber alertas no iPhone/iPad: toque em Compartilhar → \"Adicionar à Tela de Início\" e depois abra o app pela Tela de Início.", "📲 Pour recevoir des alertes sur iPhone/iPad : touchez Partager → « Sur l'écran d'accueil », puis ouvrez l'appli à partir de votre écran d'accueil.", "📲 Pou resevwa alèt sou iPhone/iPad: touche Share → \"Add to Home Screen\", epi louvri aplikasyon an depi sou ekran akèy ou."],
  "🔕 Alerts are blocked for this app. Turn them on in your device or browser settings.": ["🔕 Las alertas están bloqueadas para esta app. Actívelas en la configuración de su dispositivo o navegador.", "🔕 Os alertas estão bloqueados para este app. Ative nas configurações do seu dispositivo ou navegador.", "🔕 Les alertes sont bloquées pour cette appli. Activez-les dans les réglages de votre appareil ou de votre navigateur.", "🔕 Alèt yo bloke pou aplikasyon sa a. Limen yo nan paramèt aparèy ou oswa navigatè ou."],
  "🔔 Alerts on — turn off on this device": ["🔔 Alertas activadas — desactivar en este dispositivo", "🔔 Alertas ativados — desativar neste dispositivo", "🔔 Alertes activées — désactiver sur cet appareil", "🔔 Alèt limen — etenn yo sou aparèy sa a"],
  "Turning on…": ["Activando…", "Ativando…", "Activation…", "Ap limen…"],
  "🔔 Turn on alerts on this device": ["🔔 Activar alertas en este dispositivo", "🔔 Ativar alertas neste dispositivo", "🔔 Activer les alertes sur cet appareil", "🔔 Limen alèt sou aparèy sa a"],

  // ---- GolfCartCard ----
  "Insurance expired — please upload your renewal": ["Seguro vencido — suba su renovación, por favor", "Seguro vencido — envie a renovação, por favor", "Assurance expirée — veuillez téléverser votre renouvellement", "Asirans lan ekspire — tanpri voye renouvèlman an"],
  "Insurance expires in {n} day(s)": ["El seguro vence en {n} día(s)", "O seguro vence em {n} dia(s)", "L'assurance expire dans {n} jour(s)", "Asirans lan ap ekspire nan {n} jou"],
  "Please upload a photo or a PDF.": ["Suba una foto o un PDF.", "Envie uma foto ou um PDF.", "Veuillez téléverser une photo ou un PDF.", "Tanpri voye yon foto oswa yon PDF."],
  "Could not upload the insurance copy: {detail}": ["No se pudo subir la copia del seguro: {detail}", "Não foi possível enviar a cópia do seguro: {detail}", "Impossible de téléverser la copie de l'assurance : {detail}", "Nou pa t kapab voye kopi asirans lan: {detail}"],
  "Could not save: {detail}": ["No se pudo guardar: {detail}", "Não foi possível salvar: {detail}", "Impossible d'enregistrer : {detail}", "Nou pa t kapab anrejistre: {detail}"],
  "🛺 Golf Cart": ["🛺 Carrito de golf", "🛺 Carrinho de golfe", "🛺 Voiturette de golf", "🛺 Kabwèt gòlf"],
  "No golf cart on file.": ["No hay carrito de golf registrado.", "Nenhum carrinho de golfe cadastrado.", "Aucune voiturette de golf au dossier.", "Pa gen kabwèt gòlf ki anrejistre."],
  "Serial/Tag: {value}": ["Serie/placa: {value}", "Série/placa: {value}", "N° de série/plaque : {value}", "Nimewo seri/plak: {value}"],
  "Insurance: {company} · Policy {policy} · Expires {date}": ["Seguro: {company} · Póliza {policy} · Vence {date}", "Seguro: {company} · Apólice {policy} · Vence {date}", "Assurance : {company} · Police {policy} · Expire le {date}", "Asirans: {company} · Polis {policy} · Ekspire {date}"],
  "Insurance copy on file": ["Copia del seguro registrada", "Cópia do seguro cadastrada", "Copie de l'assurance au dossier", "Kopi asirans lan anrejistre"],
  "Insurance copy not uploaded": ["No ha subido la copia del seguro", "Cópia do seguro não enviada", "Copie de l'assurance non téléversée", "Kopi asirans lan poko voye"],
  "Golf carts must be insured and driven only by a person with a valid driver's license.": ["Los carritos de golf deben estar asegurados y solo puede manejarlos una persona con licencia de conducir vigente.", "Os carrinhos de golfe precisam ter seguro e só podem ser dirigidos por quem tem carteira de motorista válida.", "Les voiturettes de golf doivent être assurées et conduites uniquement par une personne titulaire d'un permis de conduire valide.", "Kabwèt gòlf yo dwe gen asirans, epi se sèlman yon moun ki gen yon lisans kondui ki valab ki ka kondui yo."],
  "Edit Golf Cart": ["Editar carrito de golf", "Editar carrinho de golfe", "Modifier la voiturette de golf", "Modifye kabwèt gòlf la"],
  " Up to {n} golf cart(s).": [" Hasta {n} carrito(s) de golf.", " Até {n} carrinho(s) de golfe.", " Jusqu'à {n} voiturette(s) de golf.", " Jiska {n} kabwèt gòlf."],
  "Golf Cart {n}": ["Carrito de golf {n}", "Carrinho de golfe {n}", "Voiturette de golf {n}", "Kabwèt gòlf {n}"],
  "e.g. Club Car": ["p. ej. Club Car", "ex.: Club Car", "p. ex. Club Car", "egz. Club Car"],
  "Serial # or tag # (optional)": ["Número de serie o de placa (opcional)", "Número de série ou da placa (opcional)", "N° de série ou de plaque (facultatif)", "Nimewo seri oswa nimewo plak (si ou vle)"],
  "Insurance company": ["Compañía de seguros", "Seguradora", "Compagnie d'assurance", "Konpayi asirans"],
  "Policy #": ["Póliza n.º", "Apólice nº", "N° de police", "Nimewo polis"],
  "Insurance expiration date": ["Fecha de vencimiento del seguro", "Data de vencimento do seguro", "Date d'expiration de l'assurance", "Dat asirans lan ekspire"],
  "Copy of insurance (photo or PDF)": ["Copia del seguro (foto o PDF)", "Cópia do seguro (foto ou PDF)", "Copie de l'assurance (photo ou PDF)", "Kopi asirans lan (foto oswa PDF)"],
  " — optional": [" — opcional", " — opcional", " — facultatif", " — si ou vle"],
  "✓ On file": ["✓ Registrada", "✓ Cadastrada", "✓ Au dossier", "✓ Anrejistre"],
  "Replace": ["Reemplazar", "Substituir", "Remplacer", "Ranplase"],
  "+ Add a golf cart": ["+ Agregar un carrito de golf", "+ Adicionar um carrinho de golfe", "+ Ajouter une voiturette de golf", "+ Ajoute yon kabwèt gòlf"],

  // ---- Electric usage history ----
  "Could not load electric history.": ["No se pudo cargar el historial eléctrico.", "Não foi possível carregar o histórico de energia.", "Impossible de charger l'historique d'électricité.", "Nou pa t kapab chaje istorik elektrisite a."],
  "Search and view your monthly electric readings.": ["Busque y vea sus lecturas eléctricas mensuales.", "Busque e veja suas leituras mensais de energia.", "Recherchez et consultez vos relevés d'électricité mensuels.", "Chèche epi gade lekti elektrisite chak mwa ou yo."],
  "Search by month or year, example: June 2026": ["Buscar por mes o año, por ejemplo: junio 2026", "Buscar por mês ou ano, por exemplo: junho 2026", "Recherchez par mois ou par année, par exemple : juin 2026", "Chèche pa mwa oswa pa ane, egzanp: jen 2026"],
  "Showing readings for {year}. Search above to find a different month or year.": ["Mostrando las lecturas de {year}. Use el buscador para encontrar otro mes o año.", "Mostrando as leituras de {year}. Use a busca acima para encontrar outro mês ou ano.", "Relevés de {year}. Faites une recherche ci-dessus pour trouver un autre mois ou une autre année.", "N ap montre lekti {year} yo. Chèche anlè a pou jwenn yon lòt mwa oswa yon lòt ane."],
  "📊 Monthly Electric Usage": ["📊 Consumo eléctrico mensual", "📊 Consumo mensal de energia", "📊 Consommation d'électricité mensuelle", "📊 Konsomasyon elektrisite chak mwa"],
  "No electric history found.": ["No hay historial eléctrico.", "Nenhum histórico de energia.", "Aucun historique d'électricité trouvé.", "Pa gen istorik elektrisite."],
  "No readings match your search.": ["Ninguna lectura coincide con su búsqueda.", "Nenhuma leitura corresponde à sua busca.", "Aucun relevé ne correspond à votre recherche.", "Pa gen lekti ki koresponn ak rechèch ou a."],
  "No electric readings for {year} yet.": ["Todavía no hay lecturas eléctricas de {year}.", "Ainda não há leituras de energia de {year}.", "Aucun relevé d'électricité pour {year} pour l'instant.", "Poko gen lekti elektrisite pou {year}."],
  "View details": ["Ver detalles", "Ver detalhes", "Voir les détails", "Gade detay yo"],
  "Meter reading": ["Lectura del medidor", "Leitura do medidor", "Relevé du compteur", "Lekti kontè a"],
  "Used": ["Consumido", "Consumido", "Consommé", "Konsome"],
  "Included": ["Incluido", "Incluído", "Inclus", "Enkli"],
  "Billable": ["Facturable", "Cobrado", "Facturable", "Pou peye"],
  "Rate": ["Tarifa", "Tarifa", "Tarif", "Pri"],
  "{amount} per kWh": ["{amount} por kWh", "{amount} por kWh", "{amount} par kWh", "{amount} pou chak kWh"],
  "Meter #": ["Medidor n.º", "Medidor nº", "Compteur n°", "Nimewo kontè"],
  "{exact}, rounded to {charge}": ["{exact}, redondeado a {charge}", "{exact}, arredondado para {charge}", "{exact}, arrondi à {charge}", "{exact}, awondi a {charge}"],
  "{used} kWh used − {included} kWh included = {billable} kWh × {rate} = {total}": ["{used} kWh consumidos − {included} kWh incluidos = {billable} kWh × {rate} = {total}", "{used} kWh consumidos − {included} kWh incluídos = {billable} kWh × {rate} = {total}", "{used} kWh consommés − {included} kWh inclus = {billable} kWh × {rate} = {total}", "{used} kWh konsome − {included} kWh enkli = {billable} kWh × {rate} = {total}"],

  // ---- Login / reset password ----
  "Resident Login": ["Acceso de residentes", "Acesso do morador", "Connexion des résidents", "Koneksyon rezidan"],
  "Access your account to view invoices and make payments.": ["Entre a su cuenta para ver sus facturas y hacer pagos.", "Acesse sua conta para ver faturas e fazer pagamentos.", "Accédez à votre compte pour consulter vos factures et faire des paiements.", "Antre nan kont ou pou gade fakti ou yo epi fè peman."],
  "Sign In": ["Iniciar sesión", "Entrar", "Se connecter", "Konekte"],
  "Pay Invoice Now": ["Pagar factura ahora", "Pagar fatura agora", "Payer la facture maintenant", "Peye fakti a kounye a"],
  "Password": ["Contraseña", "Senha", "Mot de passe", "Modpas"],
  "Forgot password?": ["¿Olvidó su contraseña?", "Esqueceu a senha?", "Mot de passe oublié?", "Ou bliye modpas ou?"],
  "Signing in...": ["Entrando...", "Entrando...", "Connexion...", "Ap konekte..."],
  "Sign In →": ["Iniciar sesión →", "Entrar →", "Se connecter →", "Konekte →"],
  "Don't have an account? Contact the office at": ["¿No tiene cuenta? Comuníquese con la oficina al", "Não tem conta? Fale com o escritório pelo", "Vous n'avez pas de compte? Communiquez avec le bureau au", "Ou pa gen kont? Kontakte biwo a nan"],
  "Reset Password": ["Restablecer contraseña", "Redefinir senha", "Réinitialiser le mot de passe", "Chanje modpas"],
  "Enter your email and we'll send you a secure link to set a new password.": ["Escriba su correo y le enviaremos un enlace seguro para crear una contraseña nueva.", "Digite seu e-mail e enviaremos um link seguro para criar uma nova senha.", "Entrez votre courriel et nous vous enverrons un lien sécurisé pour créer un nouveau mot de passe.", "Mete imel ou, n ap voye yon lyen sekirize ba ou pou w mete yon nouvo modpas."],
  "Send Reset Link": ["Enviar enlace", "Enviar link", "Envoyer le lien", "Voye lyen an"],
  "← Back to Sign In": ["← Volver a iniciar sesión", "← Voltar para entrar", "← Retour à la connexion", "← Retounen pou konekte"],
  "If an account exists for that email, a reset link has been sent.": ["Si existe una cuenta con ese correo, le enviamos un enlace para restablecer la contraseña.", "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.", "Si un compte existe pour ce courriel, un lien de réinitialisation a été envoyé.", "Si gen yon kont pou imel sa a, nou voye yon lyen pou chanje modpas la."],
  "Invalid email or password. Please try again.": ["Correo o contraseña incorrectos. Inténtelo de nuevo.", "E-mail ou senha incorretos. Tente novamente.", "Courriel ou mot de passe invalide. Veuillez réessayer.", "Imel oswa modpas la pa bon. Tanpri eseye ankò."],
  "This reset link is invalid. Please request a new one.": ["Este enlace no es válido. Pida uno nuevo.", "Este link é inválido. Peça um novo.", "Ce lien de réinitialisation est invalide. Veuillez en demander un nouveau.", "Lyen pou chanje modpas sa a pa bon. Tanpri mande yon lòt."],
  "Passwords do not match.": ["Las contraseñas no coinciden.", "As senhas não coincidem.", "Les mots de passe ne correspondent pas.", "De modpas yo pa menm."],
  "Unable to reset password.": ["No se pudo restablecer la contraseña.", "Não foi possível redefinir a senha.", "Impossible de réinitialiser le mot de passe.", "Nou pa t kapab chanje modpas la."],
  "Password updated. You can now sign in with your new password.": ["Contraseña actualizada. Ya puede iniciar sesión con su nueva contraseña.", "Senha atualizada. Agora você pode entrar com a nova senha.", "Mot de passe mis à jour. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.", "Modpas la chanje. Kounye a ou ka konekte ak nouvo modpas ou."],
  "New Password": ["Contraseña nueva", "Nova senha", "Nouveau mot de passe", "Nouvo modpas"],
  "Confirm Password": ["Confirmar contraseña", "Confirmar senha", "Confirmer le mot de passe", "Konfime modpas la"],
  "Updating...": ["Actualizando...", "Atualizando...", "Mise à jour...", "Ap mete ajou..."],
  "Update Password": ["Actualizar contraseña", "Atualizar senha", "Mettre à jour le mot de passe", "Chanje modpas la"],
  "At least 9 characters, with 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.": ["Al menos 9 caracteres, con 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial.", "Pelo menos 9 caracteres, com 1 letra maiúscula, 1 minúscula, 1 número e 1 caractere especial.", "Au moins 9 caractères, avec 1 lettre majuscule, 1 lettre minuscule, 1 chiffre et 1 caractère spécial.", "Omwen 9 karaktè, ak 1 lèt majiskil, 1 lèt miniskil, 1 chif ak 1 karaktè espesyal."],
  "you@example.com": ["usted@ejemplo.com", "voce@exemplo.com", "vous@exemple.com", "ou@egzanp.com"],

  // ---- Invoices page ----
  "Could not load invoices: {detail}": ["No se pudieron cargar las facturas: {detail}", "Não foi possível carregar as faturas: {detail}", "Impossible de charger les factures : {detail}", "Nou pa t kapab chaje fakti yo: {detail}"],
  "Could not load invoices (unexpected error): {detail}": ["No se pudieron cargar las facturas (error inesperado): {detail}", "Não foi possível carregar as faturas (erro inesperado): {detail}", "Impossible de charger les factures (erreur inattendue) : {detail}", "Nou pa t kapab chaje fakti yo (erè nou pa t prevwa): {detail}"],
  "Could not download invoice: {detail}": ["No se pudo descargar la factura: {detail}", "Não foi possível baixar a fatura: {detail}", "Impossible de télécharger la facture : {detail}", "Nou pa t kapab telechaje fakti a: {detail}"],
  "Could not download invoice (unexpected error): {detail}": ["No se pudo descargar la factura (error inesperado): {detail}", "Não foi possível baixar a fatura (erro inesperado): {detail}", "Impossible de télécharger la facture (erreur inattendue) : {detail}", "Nou pa t kapab telechaje fakti a (erè nou pa t prevwa): {detail}"],
  "No due date": ["Sin fecha de vencimiento", "Sem vencimento", "Aucune date d'échéance", "Pa gen dat limit"],
  "Loading invoices...": ["Cargando facturas...", "Carregando faturas...", "Chargement des factures...", "Ap chaje fakti yo..."],
  "Invoices": ["Facturas", "Faturas", "Factures", "Fakti"],
  "View your monthly invoices and charge breakdown, or download a printable PDF.": ["Vea sus facturas mensuales y el detalle de cargos, o descargue un PDF para imprimir.", "Veja suas faturas mensais e o detalhamento das cobranças, ou baixe um PDF para imprimir.", "Consultez vos factures mensuelles et le détail des frais, ou téléchargez un PDF imprimable.", "Gade fakti chak mwa ou yo ak detay frè yo, oswa telechaje yon PDF pou enprime."],
  "Search by month or year": ["Buscar por mes o año", "Buscar por mês ou ano", "Rechercher par mois ou par année", "Chèche pa mwa oswa pa ane"],
  "e.g. August, or 2026": ["p. ej. agosto, o 2026", "ex.: agosto, ou 2026", "p. ex. août, ou 2026", "egz. out, oswa 2026"],
  "Showing invoices for {year}. Search above to find invoices from a different month or year.": ["Mostrando las facturas de {year}. Use el buscador para encontrar facturas de otro mes o año.", "Mostrando as faturas de {year}. Use a busca acima para encontrar faturas de outro mês ou ano.", "Factures de {year}. Faites une recherche ci-dessus pour trouver des factures d'un autre mois ou d'une autre année.", "N ap montre fakti {year} yo. Chèche anlè a pou jwenn fakti yon lòt mwa oswa yon lòt ane."],
  "No invoices found yet.": ["Todavía no hay facturas.", "Ainda não há faturas.", "Aucune facture pour l'instant.", "Poko gen fakti."],
  "No invoices match your search.": ["Ninguna factura coincide con su búsqueda.", "Nenhuma fatura corresponde à sua busca.", "Aucune facture ne correspond à votre recherche.", "Pa gen fakti ki koresponn ak rechèch ou a."],
  "No invoices for {year} yet.": ["Todavía no hay facturas de {year}.", "Ainda não há faturas de {year}.", "Aucune facture pour {year} pour l'instant.", "Poko gen fakti pou {year}."],
  "Invoice": ["Factura", "Fatura", "Facture", "Fakti"],
  "Due: {date}": ["Vence: {date}", "Vencimento: {date}", "Échéance : {date}", "Dat limit: {date}"],
  "Upcoming — available to pay on {date}": ["Próxima — disponible para pagar el {date}", "Próxima — disponível para pagamento em {date}", "À venir — payable à partir du {date}", "K ap vini — ou ka peye l apati {date}"],
  "Preparing...": ["Preparando...", "Preparando...", "Préparation...", "Ap prepare..."],
  "⬇ Download PDF": ["⬇ Descargar PDF", "⬇ Baixar PDF", "⬇ Télécharger le PDF", "⬇ Telechaje PDF la"],
  "Invoice PDFs are in English.": ["Los PDF de las facturas están en inglés.", "Os PDFs das faturas estão em inglês.", "Les PDF des factures sont en anglais.", "PDF fakti yo an anglè."],

  // ---- Payment history ----
  "Could not load payment history: {detail}": ["No se pudo cargar el historial de pagos: {detail}", "Não foi possível carregar o histórico de pagamentos: {detail}", "Impossible de charger l'historique des paiements : {detail}", "Nou pa t kapab chaje istorik peman yo: {detail}"],
  "Could not load payment history (unexpected error): {detail}": ["No se pudo cargar el historial de pagos (error inesperado): {detail}", "Não foi possível carregar o histórico de pagamentos (erro inesperado): {detail}", "Impossible de charger l'historique des paiements (erreur inattendue) : {detail}", "Nou pa t kapab chaje istorik peman yo (erè nou pa t prevwa): {detail}"],
  "No payment date": ["Sin fecha de pago", "Sem data de pagamento", "Aucune date de paiement", "Pa gen dat peman"],
  "Last {n} days": ["Últimos {n} días", "Últimos {n} dias", "{n} derniers jours", "{n} dènye jou yo"],
  "Loading payment history...": ["Cargando historial de pagos...", "Carregando histórico de pagamentos...", "Chargement de l'historique des paiements...", "Ap chaje istorik peman yo..."],
  "Payment History": ["Historial de pagos", "Histórico de pagamentos", "Historique des paiements", "Istorik peman"],
  "View a statement of your completed payments.": ["Vea un estado de cuenta de sus pagos realizados.", "Veja um extrato dos seus pagamentos concluídos.", "Consultez un relevé de vos paiements effectués.", "Gade yon rapò sou peman ou fin fè yo."],
  "Show transactions from:": ["Mostrar movimientos de:", "Mostrar transações de:", "Afficher les transactions de :", "Montre tranzaksyon:"],
  "Specific Month": ["Un mes específico", "Um mês específico", "Un mois précis", "Yon mwa espesyal"],
  "Specific Year": ["Un año específico", "Um ano específico", "Une année précise", "Yon ane espesyal"],
  "Total for this period": ["Total de este período", "Total deste período", "Total pour cette période", "Total pou peryòd sa a"],
  "🖨️ Print": ["🖨️ Imprimir", "🖨️ Imprimir", "🖨️ Imprimer", "🖨️ Enprime"],
  "No payments found for this period.": ["No hay pagos en este período.", "Nenhum pagamento neste período.", "Aucun paiement trouvé pour cette période.", "Pa gen peman pou peryòd sa a."],
  "DATE": ["FECHA", "DATA", "DATE", "DAT"],
  "DESCRIPTION": ["DESCRIPCIÓN", "DESCRIÇÃO", "DESCRIPTION", "DESKRIPSYON"],
  "METHOD": ["FORMA", "FORMA", "MODE", "MWAYEN"],
  "AMOUNT": ["MONTO", "VALOR", "MONTANT", "KANTITE"],
  "Bank (ACH)": ["Banco (ACH)", "Banco (ACH)", "Banque (ACH)", "Bank (ACH)"],
  "Cash": ["Efectivo", "Dinheiro", "Comptant", "Kach"],
  "Check": ["Cheque", "Cheque", "Chèque", "Chèk"],
  "Money Order": ["Giro postal", "Ordem de pagamento", "Mandat-poste", "Manda"],
  "Autopay (card)": ["Pago automático (tarjeta)", "Pagamento automático (cartão)", "Paiement automatique (carte)", "Peman otomatik (kat)"],
  "Autopay (bank)": ["Pago automático (banco)", "Pagamento automático (banco)", "Paiement automatique (banque)", "Peman otomatik (bank)"],
  "Rent": ["Alquiler", "Aluguel", "Loyer", "Lwaye"],
  "Monthly Rent": ["Alquiler mensual", "Aluguel mensal", "Loyer mensuel", "Lwaye chak mwa"],
  "Electric": ["Electricidad", "Energia", "Électricité", "Elektrisite"],
  "Electric Service": ["Servicio eléctrico", "Serviço de energia", "Service d'électricité", "Sèvis elektrisite"],
  "Late Fee": ["Recargo por pago tardío", "Multa por atraso", "Frais de retard", "Frè reta"],
  "Security Deposit": ["Depósito de seguridad", "Depósito caução", "Dépôt de garantie", "Depo garanti"],
  "Monthly Invoice": ["Factura mensual", "Fatura mensal", "Facture mensuelle", "Fakti chak mwa"],
  "Processing Fee": ["Cargo por procesamiento", "Taxa de processamento", "Frais de traitement", "Frè tretman"],
  "Water": ["Agua", "Água", "Eau", "Dlo"],
  "Trash": ["Basura", "Lixo", "Ordures", "Fatra"],
  "Wifi": ["Wifi", "Wi-Fi", "Wi-Fi", "Wifi"],
  "Propane (charge)": ["Propano", "Propano", "Propane", "Pwopàn"],

  // ---- Documents ----
  "General": ["General", "Geral", "Général", "Jeneral"],
  "Site Rental Agreement": ["Contrato de alquiler del espacio", "Contrato de locação do espaço", "Contrat de location de terrain", "Kontra lwaye espas"],
  "ID": ["Identificación", "Documento de identidade", "Pièce d'identité", "ID"],
  "Insurance": ["Seguro", "Seguro", "Assurance", "Asirans"],
  "Registration": ["Registro del vehículo", "Registro do veículo", "Immatriculation", "Rejistrasyon machin"],
  "Move-Out / Cancellation Statement": ["Estado de cuenta de mudanza / cancelación", "Extrato de mudança / cancelamento", "Relevé de départ / d'annulation", "Rapò demenajman / anilasyon"],
  "Bill of Sale": ["Contrato de compraventa", "Contrato de compra e venda", "Acte de vente", "Papye vant (Bill of Sale)"],
  "Resident Agreement (signed online)": ["Acuerdo de residente (firmado en línea)", "Acordo de morador (assinado on-line)", "Entente de résident (signée en ligne)", "Akò rezidan (siyen sou entènèt)"],
  "Could not load your documents: {detail}": ["No se pudieron cargar sus documentos: {detail}", "Não foi possível carregar seus documentos: {detail}", "Impossible de charger vos documents : {detail}", "Nou pa t kapab chaje dokiman ou yo: {detail}"],
  "Could not load your documents (unexpected error): {detail}": ["No se pudieron cargar sus documentos (error inesperado): {detail}", "Não foi possível carregar seus documentos (erro inesperado): {detail}", "Impossible de charger vos documents (erreur inattendue) : {detail}", "Nou pa t kapab chaje dokiman ou yo (erè nou pa t prevwa): {detail}"],
  "Please choose a file first.": ["Primero elija un archivo.", "Escolha um arquivo primeiro.", "Veuillez d'abord choisir un fichier.", "Tanpri chwazi yon fichye anvan."],
  "Could not read file.": ["No se pudo leer el archivo.", "Não foi possível ler o arquivo.", "Impossible de lire le fichier.", "Nou pa t kapab li fichye a."],
  "Could not save document: {detail}": ["No se pudo guardar el documento: {detail}", "Não foi possível salvar o documento: {detail}", "Impossible d'enregistrer le document : {detail}", "Nou pa t kapab anrejistre dokiman an: {detail}"],
  "✅ Document uploaded.": ["✅ Documento subido.", "✅ Documento enviado.", "✅ Document téléversé.", "✅ Dokiman an voye."],
  "Could not upload document (unexpected error): {detail}": ["No se pudo subir el documento (error inesperado): {detail}", "Não foi possível enviar o documento (erro inesperado): {detail}", "Impossible de téléverser le document (erreur inattendue) : {detail}", "Nou pa t kapab voye dokiman an (erè nou pa t prevwa): {detail}"],
  "Could not open this document.": ["No se pudo abrir este documento.", "Não foi possível abrir este documento.", "Impossible d'ouvrir ce document.", "Nou pa t kapab louvri dokiman sa a."],
  "Could not open this document: {detail}": ["No se pudo abrir este documento: {detail}", "Não foi possível abrir este documento: {detail}", "Impossible d'ouvrir ce document : {detail}", "Nou pa t kapab louvri dokiman sa a: {detail}"],
  "Remove this document?": ["¿Quitar este documento?", "Remover este documento?", "Retirer ce document?", "Retire dokiman sa a?"],
  "Could not remove document: {detail}": ["No se pudo quitar el documento: {detail}", "Não foi possível remover o documento: {detail}", "Impossible de retirer le document : {detail}", "Nou pa t kapab retire dokiman an: {detail}"],
  "Could not remove document (unexpected error): {detail}": ["No se pudo quitar el documento (error inesperado): {detail}", "Não foi possível remover o documento (erro inesperado): {detail}", "Impossible de retirer le document (erreur inattendue) : {detail}", "Nou pa t kapab retire dokiman an (erè nou pa t prevwa): {detail}"],
  "Loading your documents...": ["Cargando sus documentos...", "Carregando seus documentos...", "Chargement de vos documents...", "Ap chaje dokiman ou yo..."],
  "My Documents": ["Mis documentos", "Meus documentos", "Mes documents", "Dokiman mwen"],
  "View and download your signed site rental agreement(s) and other documents on file.": ["Vea y descargue su(s) contrato(s) de alquiler del espacio firmado(s) y otros documentos registrados.", "Veja e baixe seu(s) contrato(s) de locação do espaço assinado(s) e outros documentos cadastrados.", "Consultez et téléchargez vos contrats de location de terrain signés et les autres documents au dossier.", "Gade epi telechaje kontra lwaye espas ou te siyen yo ak lòt dokiman ki anrejistre."],
  "SITE RENTAL AGREEMENT(S)": ["CONTRATO(S) DE ALQUILER DEL ESPACIO", "CONTRATO(S) DE LOCAÇÃO DO ESPAÇO", "CONTRAT(S) DE LOCATION DE TERRAIN", "KONTRA LWAYE ESPAS"],
  "No lease documents on file yet.": ["Todavía no hay contratos registrados.", "Ainda não há contratos cadastrados.", "Aucun document de bail au dossier pour l'instant.", "Poko gen dokiman kontra lwaye ki anrejistre."],
  "{rent}/mo · Deposit: {deposit}": ["{rent}/mes · Depósito: {deposit}", "{rent}/mês · Depósito: {deposit}", "{rent}/mois · Dépôt : {deposit}", "{rent}/mwa · Depo: {deposit}"],
  "📄 View / Print PDF": ["📄 Ver / imprimir PDF", "📄 Ver / imprimir PDF", "📄 Voir / imprimer le PDF", "📄 Gade / enprime PDF la"],
  "PDF not available": ["PDF no disponible", "PDF indisponível", "PDF non disponible", "PDF pa disponib"],
  "OTHER DOCUMENTS": ["OTROS DOCUMENTOS", "OUTROS DOCUMENTOS", "AUTRES DOCUMENTS", "LÒT DOKIMAN"],
  "Upload a document (ID, insurance, registration, etc.)": ["Subir un documento (identificación, seguro, registro, etc.)", "Enviar um documento (identidade, seguro, registro etc.)", "Téléverser un document (pièce d'identité, assurance, immatriculation, etc.)", "Voye yon dokiman (ID, asirans, rejistrasyon, elatriye)"],
  "Choose the type below, then choose a file — it uploads automatically, no extra button to click.": ["Elija el tipo abajo y luego el archivo — se sube automáticamente, sin otro botón.", "Escolha o tipo abaixo e depois o arquivo — ele é enviado automaticamente, sem outro botão.", "Choisissez le type ci-dessous, puis le fichier — il se téléverse automatiquement, aucun autre bouton à cliquer.", "Chwazi kalite a anba a, epi chwazi yon fichye — li voye poukont li, pa gen lòt bouton pou peze."],
  "This is for: Myself": ["Es para: mí", "É para: mim", "Pour : moi-même", "Se pou: mwen menm"],
  "This is for: {name}": ["Es para: {name}", "É para: {name}", "Pour : {name}", "Se pou: {name}"],
  "No documents uploaded yet.": ["Todavía no ha subido documentos.", "Nenhum documento enviado ainda.", "Aucun document téléversé pour l'instant.", "Ou poko voye okenn dokiman."],
  "📄 View": ["📄 Ver", "📄 Ver", "📄 Voir", "📄 Gade"],
  "You still need to pay for and start 1 background check.": ["Todavía le falta pagar e iniciar 1 verificación de antecedentes.", "Você ainda precisa pagar e iniciar 1 verificação de antecedentes.", "Vous devez encore payer et commencer 1 vérification des antécédents.", "Ou toujou bezwen peye epi kòmanse 1 verifikasyon dosye."],
  "You still need to pay for and start {n} background checks.": ["Todavía le falta pagar e iniciar {n} verificaciones de antecedentes.", "Você ainda precisa pagar e iniciar {n} verificações de antecedentes.", "Vous devez encore payer et commencer {n} vérifications des antécédents.", "Ou toujou bezwen peye epi kòmanse {n} verifikasyon dosye."],
  "Uploading an ID here doesn't start the check by itself — head to Background Checks to finish it.": ["Subir una identificación aquí no inicia la verificación por sí solo — vaya a Verificaciones de antecedentes para terminarla.", "Enviar um documento aqui não inicia a verificação sozinho — vá até Verificações de antecedentes para concluir.", "Téléverser une pièce d'identité ici ne lance pas la vérification à lui seul — allez à Vérifications des antécédents pour la terminer.", "Voye yon ID isit la pa kòmanse verifikasyon an poukont li — ale nan Verifikasyon dosye pou fini l."],

  // ---- Maintenance page ----
  "Are you sure you want to cancel this maintenance request?": ["¿Seguro que desea cancelar esta solicitud de mantenimiento?", "Tem certeza de que quer cancelar esta solicitação de manutenção?", "Voulez-vous vraiment annuler cette demande d'entretien?", "Èske ou sèten ou vle anile demann antretyen sa a?"],
  "Could not cancel request.": ["No se pudo cancelar la solicitud.", "Não foi possível cancelar a solicitação.", "Impossible d'annuler la demande.", "Nou pa t kapab anile demann lan."],
  "Maintenance request cancelled.": ["Solicitud de mantenimiento cancelada.", "Solicitação de manutenção cancelada.", "Demande d'entretien annulée.", "Demann antretyen an anile."],
  "Please enter a subject.": ["Escriba un asunto.", "Digite um assunto.", "Veuillez entrer un objet.", "Tanpri ekri yon sijè."],
  "Could not create request.": ["No se pudo crear la solicitud.", "Não foi possível criar a solicitação.", "Impossible de créer la demande.", "Nou pa t kapab kreye demann lan."],
  "Your request was sent, but the photo could not be uploaded.": ["Su solicitud se envió, pero no se pudo subir la foto.", "Sua solicitação foi enviada, mas não foi possível enviar a foto.", "Votre demande a été envoyée, mais la photo n'a pas pu être téléversée.", "Demann ou an ale, men nou pa t kapab voye foto a."],
  "Maintenance request submitted.": ["Solicitud de mantenimiento enviada.", "Solicitação de manutenção enviada.", "Demande d'entretien envoyée.", "Demann antretyen an voye."],
  "+ New Request": ["+ Nueva solicitud", "+ Nova solicitação", "+ Nouvelle demande", "+ Nouvo demann"],
  "New Maintenance Request": ["Nueva solicitud de mantenimiento", "Nova solicitação de manutenção", "Nouvelle demande d'entretien", "Nouvo demann antretyen"],
  "Subject": ["Asunto", "Assunto", "Objet", "Sijè"],
  "Describe the issue...": ["Describa el problema...", "Descreva o problema...", "Décrivez le problème...", "Eksplike pwoblèm nan..."],
  "Priority": ["Prioridad", "Prioridade", "Priorité", "Priyorite"],
  "Attach photo": ["Adjuntar foto", "Anexar foto", "Joindre une photo", "Mete yon foto"],
  "Take photo": ["Tomar foto", "Tirar foto", "Prendre une photo", "Pran yon foto"],
  "Submit Request": ["Enviar solicitud", "Enviar solicitação", "Envoyer la demande", "Voye demann lan"],
  "No maintenance requests found.": ["No hay solicitudes de mantenimiento.", "Nenhuma solicitação de manutenção.", "Aucune demande d'entretien trouvée.", "Pa gen demann antretyen."],
  "Submitted:": ["Enviada:", "Enviada:", "Envoyée :", "Voye:"],
  "No description provided.": ["Sin descripción.", "Sem descrição.", "Aucune description fournie.", "Pa gen deskripsyon."],
  "Status:": ["Estado:", "Status:", "Statut :", "Estati:"],
  "Priority:": ["Prioridad:", "Prioridade:", "Priorité :", "Priyorite:"],
  "Maintenance Photo": ["Foto de mantenimiento", "Foto da manutenção", "Photo d'entretien", "Foto antretyen"],
  "Updates from the office:": ["Novedades de la oficina:", "Atualizações do escritório:", "Mises à jour du bureau :", "Nouvèl biwo a:"],

  // ---- Marketplace ----
  "Womenswear": ["Ropa de mujer", "Roupa feminina", "Vêtements pour femmes", "Rad fanm"],
  "Menswear": ["Ropa de hombre", "Roupa masculina", "Vêtements pour hommes", "Rad gason"],
  "Kidswear & Baby": ["Ropa de niños y bebés", "Roupa infantil e bebê", "Vêtements pour enfants et bébés", "Rad timoun ak tibebe"],
  "Antiques": ["Antigüedades", "Antiguidades", "Antiquités", "Antikite"],
  "Books": ["Libros", "Livros", "Livres", "Liv"],
  "Movies & Music": ["Películas y música", "Filmes e música", "Films et musique", "Fim ak mizik"],
  "Classifieds": ["Clasificados", "Classificados", "Petites annonces", "Ti anons"],
  "Electronics": ["Electrónica", "Eletrônicos", "Électronique", "Elektwonik"],
  "Entertainment": ["Entretenimiento", "Entretenimento", "Divertissement", "Divètisman"],
  "Free Stuff": ["Cosas gratis", "Coisas grátis", "Articles gratuits", "Bagay gratis"],
  "Garage Sale": ["Venta de garaje", "Bazar de garagem", "Vente de garage", "Vann lakou"],
  "Patio & Garden": ["Patio y jardín", "Pátio e jardim", "Patio et jardin", "Lakou ak jaden"],
  "Health & Beauty": ["Salud y belleza", "Saúde e beleza", "Santé et beauté", "Sante ak bote"],
  "Hobbies": ["Pasatiempos", "Hobbies", "Loisirs", "Pastan"],
  "Home & Kitchen": ["Hogar y cocina", "Casa e cozinha", "Maison et cuisine", "Kay ak kizin"],
  "Home Improvement": ["Mejoras para el hogar", "Reforma e construção", "Rénovation", "Amelyorasyon kay"],
  "Home Sales": ["Venta de viviendas", "Venda de imóveis", "Maisons à vendre", "Kay pou vann"],
  "Jewelry & Watches": ["Joyas y relojes", "Joias e relógios", "Bijoux et montres", "Bijou ak mont"],
  "Luggage & Bags": ["Maletas y bolsos", "Malas e bolsas", "Bagages et sacs", "Valiz ak sak"],
  "Musical Instruments": ["Instrumentos musicales", "Instrumentos musicais", "Instruments de musique", "Enstriman mizik"],
  "Office Supplies": ["Artículos de oficina", "Material de escritório", "Fournitures de bureau", "Founiti biwo"],
  "Pet Supplies": ["Artículos para mascotas", "Artigos para animais", "Articles pour animaux", "Pwodui pou bèt"],
  "RV Parts": ["Piezas para RV", "Peças para RV", "Pièces de VR", "Pyès RV"],
  "Sporting Goods": ["Artículos deportivos", "Artigos esportivos", "Articles de sport", "Materyèl espò"],
  "Toys & Games": ["Juguetes y juegos", "Brinquedos e jogos", "Jouets et jeux", "Jwèt"],
  "Miscellaneous": ["Varios", "Diversos", "Divers", "Divès"],
  // Oct 29 (per Mely): Services category (src/lib/marketplaceServices.ts)
  "Services": ["Servicios", "Serviços", "Services", "Sèvis"],
  "Sewing & alterations": ["Costura y arreglos", "Costura e ajustes", "Couture et retouches", "Koutiri ak retouch"],
  "Beauty & hair": ["Belleza y peluquería", "Beleza e cabelo", "Beauté et coiffure", "Bote ak kwafi"],
  "Elder care / companion": ["Cuidado de personas mayores / compañía", "Cuidado de idosos / companhia", "Soins aux aînés / compagnie", "Okipe granmoun / fè konpayi"],
  "Pet care & dog walking": ["Cuidado de mascotas y paseo de perros", "Cuidado de animais e passeio com cães", "Soins aux animaux et promenade de chiens", "Okipe bèt ak pwonmennen chen"],
  "Babysitting": ["Cuidado de niños", "Babá", "Gardiennage d'enfants", "Gade timoun"],
  "Cleaning": ["Limpieza", "Limpeza", "Ménage", "Netwayaj"],
  "Handyman & repairs": ["Arreglos y reparaciones", "Reparos e manutenção", "Bricolage et réparations", "Ti travay ak reparasyon"],
  "Tutoring & lessons": ["Tutorías y clases", "Aulas particulares", "Tutorat et cours", "Leson patikilye ak kou"],
  "Cooking & meals": ["Cocina y comidas", "Culinária e refeições", "Cuisine et repas", "Kizin ak manje"],
  "Other services": ["Otros servicios", "Outros serviços", "Autres services", "Lòt sèvis"],
  "per hour": ["por hora", "por hora", "l'heure", "pa lè"],
  "per visit": ["por visita", "por visita", "par visite", "pa vizit"],
  "per service": ["por servicio", "por serviço", "par service", "pa sèvis"],
  "Ask for price": ["Pregunte el precio", "Consulte o preço", "Demandez le prix", "Mande pri a"],
  // Oct 29: invoice line added by the office (CreateInvoiceModule in melyos-builder)
  "Pressure Washing": ["Lavado a presión", "Lavagem a pressão", "Lavage à pression", "Lave ak presyon"],
  "Type of service": ["Tipo de servicio", "Tipo de serviço", "Type de service", "Kalite sèvis"],
  "Price unit": ["Unidad de precio", "Unidade de preço", "Unité de prix", "Inite pri"],
  "Price ($, optional)": ["Precio ($, opcional)", "Preço ($, opcional)", "Prix ($, facultatif)", "Pri ($, si ou vle)"],
  "All services": ["Todos los servicios", "Todos os serviços", "Tous les services", "Tout sèvis"],
  "Arrange services directly with the neighbor. The park is not responsible for services between residents.": ["Acuerde los servicios directamente con el vecino. El parque no se hace responsable de los servicios entre residentes.", "Combine os serviços diretamente com o vizinho. O parque não se responsabiliza por serviços entre moradores.", "Organisez les services directement avec le voisin. Le parc n'est pas responsable des services entre résidents.", "Fè aranjman pou sèvis yo dirèkteman ak vwazen an. Pak la pa responsab sèvis ant rezidan."],
  "Please enter a title.": ["Escriba un título.", "Digite um título.", "Veuillez entrer un titre.", "Tanpri ekri yon tit."],
  "Could not save listing: {detail}": ["No se pudo guardar el anuncio: {detail}", "Não foi possível salvar o anúncio: {detail}", "Impossible d'enregistrer l'annonce : {detail}", "Nou pa t kapab anrejistre anons lan: {detail}"],
  "Delete this listing?": ["¿Eliminar este anuncio?", "Excluir este anúncio?", "Supprimer cette annonce?", "Efase anons sa a?"],
  "← Back to Marketplace": ["← Volver al Marketplace", "← Voltar ao Marketplace", "← Retour au Marketplace", "← Retounen nan Marketplace"],
  "No photos": ["Sin fotos", "Sem fotos", "Aucune photo", "Pa gen foto"],
  "✅ Copied": ["✅ Copiado", "✅ Copiado", "✅ Copié", "✅ Kopye"],
  "🔗 Share": ["🔗 Compartir", "🔗 Compartilhar", "🔗 Partager", "🔗 Pataje"],
  "Share": ["Compartir", "Compartilhar", "Partager", "Pataje"],
  "Free / Make an offer": ["Gratis / Haga una oferta", "Grátis / Faça uma oferta", "Gratuit / Faites une offre", "Gratis / Fè yon òf"],
  "SOLD": ["VENDIDO", "VENDIDO", "VENDU", "VANN"],
  "Category: {name}": ["Categoría: {name}", "Categoria: {name}", "Catégorie : {name}", "Kategori: {name}"],
  "Expires in {n} day — repost to keep it active": ["Vence en {n} día — vuelva a publicarlo para mantenerlo activo", "Expira em {n} dia — republique para mantê-lo ativo", "Expire dans {n} jour — republiez pour la garder active", "Ekspire nan {n} jou — reposte l pou l rete aktif"],
  "Expires in {n} days — repost to keep it active": ["Vence en {n} días — vuelva a publicarlo para mantenerlo activo", "Expira em {n} dias — republique para mantê-lo ativo", "Expire dans {n} jours — republiez pour la garder active", "Ekspire nan {n} jou — reposte l pou l rete aktif"],
  "This listing has expired": ["Este anuncio venció", "Este anúncio expirou", "Cette annonce est expirée", "Anons sa a ekspire"],
  "Seller": ["Vendedor", "Vendedor", "Vendeur", "Machann"],
  "Posted by {park}": ["Publicado por {park}", "Publicado por {park}", "Publié par {park}", "{park} ki poste l"],
  "the park": ["el parque", "o parque", "le parc", "pak la"],
  "Contact the office for details.": ["Comuníquese con la oficina para más detalles.", "Fale com o escritório para mais detalhes.", "Communiquez avec le bureau pour en savoir plus.", "Kontakte biwo a pou plis detay."],
  "Contact them in person at the park, or through the office.": ["Comuníquese en persona en el parque o a través de la oficina.", "Fale pessoalmente no parque ou pelo escritório.", "Communiquez avec cette personne en personne au parc, ou par l'entremise du bureau.", "Kontakte moun nan fas a fas nan pak la, oswa pase pa biwo a."],
  "❤️ Saved": ["❤️ Guardado", "❤️ Salvo", "❤️ Enregistrée", "❤️ Sove"],
  "🤍 Save": ["🤍 Guardar", "🤍 Salvar", "🤍 Enregistrer", "🤍 Sove"],
  "Mark as Sold": ["Marcar como vendido", "Marcar como vendido", "Marquer comme vendu", "Make l vann"],
  "🔁 Repost": ["🔁 Volver a publicar", "🔁 Republicar", "🔁 Republier", "🔁 Reposte"],
  "No photo": ["Sin foto", "Sem foto", "Aucune photo", "Pa gen foto"],
  "Free / OBO": ["Gratis / Acepto ofertas", "Grátis / Aceito ofertas", "Gratuit / Offres acceptées", "Gratis / M aksepte òf"],
  "Expires in {n}d": ["Vence en {n} d", "Expira em {n} d", "Expire dans {n} j", "Ekspire nan {n} j"],
  "+ Post a Listing": ["+ Publicar un anuncio", "+ Publicar um anúncio", "+ Publier une annonce", "+ Poste yon anons"],
  "Edit Listing": ["Editar anuncio", "Editar anúncio", "Modifier l'annonce", "Modifye anons lan"],
  "New Listing": ["Nuevo anuncio", "Novo anúncio", "Nouvelle annonce", "Nouvo anons"],
  "Title (e.g. Patio Chairs, Bike Rack...)": ["Título (p. ej. sillas de patio, portabicicletas...)", "Título (ex.: cadeiras de pátio, suporte de bicicleta...)", "Titre (p. ex. chaises de patio, support à vélo...)", "Tit (egz. chèz lakou, pòt bisiklèt...)"],
  "Description": ["Descripción", "Descrição", "Description", "Deskripsyon"],
  "Price ($, leave blank for free/OBO)": ["Precio ($; déjelo en blanco si es gratis o acepta ofertas)", "Preço ($; deixe em branco se for grátis ou aceitar ofertas)", "Prix ($, laissez vide pour gratuit/offres acceptées)", "Pri ($, kite l vid pou gratis/aksepte òf)"],
  "Photos (up to 10)": ["Fotos (hasta 10)", "Fotos (até 10)", "Photos (jusqu'à 10)", "Foto (jiska 10)"],
  "You can upload up to 10 photos. Only the first 10 will be used.": ["Puede subir hasta 10 fotos. Solo se usarán las primeras 10.", "Você pode enviar até 10 fotos. Só as 10 primeiras serão usadas.", "Vous pouvez téléverser jusqu'à 10 photos. Seules les 10 premières seront utilisées.", "Ou ka voye jiska 10 foto. Se sèlman 10 premye yo ki pral sèvi."],
  "Preview {n}": ["Vista previa {n}", "Prévia {n}", "Aperçu {n}", "Apèsi {n}"],
  "Update Listing": ["Actualizar anuncio", "Atualizar anúncio", "Mettre à jour l'annonce", "Mete anons lan ajou"],
  "Post Listing": ["Publicar anuncio", "Publicar anúncio", "Publier l'annonce", "Poste anons lan"],
  "Browse": ["Explorar", "Explorar", "Parcourir", "Gade"],
  "My Listings": ["Mis anuncios", "Meus anúncios", "Mes annonces", "Anons mwen"],
  "Saved": ["Guardados", "Salvos", "Enregistrées", "Sove"],
  "Search listings...": ["Buscar anuncios...", "Buscar anúncios...", "Rechercher des annonces...", "Chèche anons..."],
  "All Categories": ["Todas las categorías", "Todas as categorias", "Toutes les catégories", "Tout kategori"],
  "🆕 New For You": ["🆕 Nuevo para usted", "🆕 Novidades para você", "🆕 Nouveau pour vous", "🆕 Nouvo pou ou"],
  "You haven't posted anything yet.": ["Todavía no ha publicado nada.", "Você ainda não publicou nada.", "Vous n'avez encore rien publié.", "Ou poko poste anyen."],
  "No listings yet.": ["Todavía no hay anuncios.", "Ainda não há anúncios.", "Aucune annonce pour l'instant.", "Poko gen anons."],

  // ---- Background checks page ----
  "Could not load background checks.": ["No se pudieron cargar las verificaciones de antecedentes.", "Não foi possível carregar as verificações de antecedentes.", "Impossible de charger les vérifications des antécédents.", "Nou pa t kapab chaje verifikasyon dosye yo."],
  "Could not load background checks (unexpected error): {detail}": ["No se pudieron cargar las verificaciones de antecedentes (error inesperado): {detail}", "Não foi possível carregar as verificações de antecedentes (erro inesperado): {detail}", "Impossible de charger les vérifications des antécédents (erreur inattendue) : {detail}", "Nou pa t kapab chaje verifikasyon dosye yo (erè nou pa t prevwa): {detail}"],
  "Could not start payment (unexpected error): {detail}": ["No se pudo iniciar el pago (error inesperado): {detail}", "Não foi possível iniciar o pagamento (erro inesperado): {detail}", "Impossible de lancer le paiement (erreur inattendue) : {detail}", "Nou pa t kapab kòmanse peman an (erè nou pa t prevwa): {detail}"],
  "Household Background Checks": ["Verificaciones de antecedentes del hogar", "Verificações de antecedentes dos moradores", "Vérifications des antécédents du ménage", "Verifikasyon dosye moun nan fwaye a"],
  "Anyone 18 or older living here permanently requires a background check.": ["Toda persona de 18 años o más que viva aquí de forma permanente necesita verificación de antecedentes.", "Toda pessoa com 18 anos ou mais que more aqui de forma permanente precisa de verificação de antecedentes.", "Toute personne de 18 ans ou plus qui vit ici de façon permanente doit faire une vérification des antécédents.", "Tout moun ki gen 18 an oswa plis ki rete isit la pou toutan bezwen yon verifikasyon dosye."],
  "Payment received — check your email for a message with instructions to complete the background check. This can take a few minutes to arrive.": ["Pago recibido — revise su correo: le llegará un mensaje con instrucciones para completar la verificación de antecedentes. Puede tardar unos minutos.", "Pagamento recebido — verifique seu e-mail: chegará uma mensagem com instruções para concluir a verificação de antecedentes. Pode levar alguns minutos.", "Paiement reçu — surveillez vos courriels : vous recevrez un message avec les instructions pour terminer la vérification des antécédents. Il peut prendre quelques minutes à arriver.", "Nou resevwa peman an — tcheke imel ou pou yon mesaj ak enstriksyon pou fini verifikasyon dosye a. Li ka pran kèk minit pou l rive."],
  "Need to add another household occupant before paying?": ["¿Necesita agregar otro ocupante del hogar antes de pagar?", "Precisa adicionar outro morador antes de pagar?", "Vous devez ajouter un autre occupant du ménage avant de payer?", "Ou bezwen ajoute yon lòt moun nan fwaye a anvan ou peye?"],
  "+ Add Household Occupant": ["+ Agregar ocupante del hogar", "+ Adicionar morador", "+ Ajouter un occupant du ménage", "+ Ajoute yon moun nan fwaye a"],
  "No background checks are pending right now.": ["No hay verificaciones de antecedentes pendientes por ahora.", "Não há verificações de antecedentes pendentes no momento.", "Aucune vérification des antécédents en attente pour l'instant.", "Pa gen verifikasyon dosye k ap tann kounye a."],
  "Select which occupant(s) to pay for now — you can pay for one, or all of them together in a single charge.": ["Elija por cuál(es) ocupante(s) pagar ahora — puede pagar por uno, o por todos juntos en un solo cobro.", "Escolha por qual(is) morador(es) pagar agora — você pode pagar por um, ou por todos juntos em uma única cobrança.", "Choisissez pour quel(s) occupant(s) payer maintenant — vous pouvez en payer un seul, ou tous ensemble en un seul paiement.", "Chwazi pou ki moun ou vle peye kounye a — ou ka peye pou yon sèl, oswa pou tout ansanm nan yon sèl peman."],
  "Total ({n} selected)": ["Total ({n} seleccionados)", "Total ({n} selecionados)", "Total ({n} sélectionné(s))", "Total ({n} chwazi)"],
  "Pay Now & Start Background Check(s)": ["Pagar ahora e iniciar verificación(es)", "Pagar agora e iniciar verificação(ões)", "Payer maintenant et lancer la ou les vérifications", "Peye kounye a epi kòmanse verifikasyon dosye"],

  // ---- Payment review ----
  "Could not verify payment.": ["No se pudo verificar el pago.", "Não foi possível verificar o pagamento.", "Impossible de vérifier le paiement.", "Nou pa t kapab verifye peman an."],
  "No charges selected.": ["No hay cargos seleccionados.", "Nenhuma cobrança selecionada.", "Aucuns frais sélectionnés.", "Ou pa chwazi okenn frè."],
  "Could not load selected charges.": ["No se pudieron cargar los cargos seleccionados.", "Não foi possível carregar as cobranças selecionadas.", "Impossible de charger les frais sélectionnés.", "Nou pa t kapab chaje frè ou chwazi yo."],
  "Loading payment review...": ["Cargando la revisión del pago...", "Carregando a revisão do pagamento...", "Chargement de la révision du paiement...", "Ap chaje revizyon peman an..."],
  "Payment Verification Failed": ["No se pudo verificar el pago", "Falha na verificação do pagamento", "Échec de la vérification du paiement", "Nou pa t kapab verifye peman an"],
  "Payment Received": ["Pago recibido", "Pagamento recebido", "Paiement reçu", "Nou resevwa peman an"],
  "Bank Payment Received": ["Pago bancario recibido", "Pagamento bancário recebido", "Paiement bancaire reçu", "Nou resevwa peman labank lan"],
  "Payment Status": ["Estado del pago", "Status do pagamento", "État du paiement", "Estati peman an"],
  "Thank you. Sign in to your resident portal to see the receipt and your balance.": ["Gracias. Entre a su portal de residentes para ver el recibo y su saldo.", "Obrigado. Entre no portal do morador para ver o recibo e seu saldo.", "Merci. Connectez-vous à votre portail des résidents pour voir le reçu et votre solde.", "Mèsi. Konekte nan pòtay rezidan ou pou w wè resi a ak balans ou."],
  "This payment hasn't been completed. Sign in to your resident portal to check your balance.": ["Este pago no se completó. Entre a su portal de residentes para revisar su saldo.", "Este pagamento não foi concluído. Entre no portal do morador para conferir seu saldo.", "Ce paiement n'a pas été effectué. Connectez-vous à votre portail des résidents pour vérifier votre solde.", "Peman sa a pa t fèt. Konekte nan pòtay rezidan ou pou w tcheke balans ou."],
  "Sign in": ["Iniciar sesión", "Entrar", "Se connecter", "Konekte"],
  "Payment Successful": ["Pago exitoso", "Pagamento concluído", "Paiement réussi", "Peman an pase"],
  "Your bank payment is processing and clears in 3–5 business days. Your invoices show \"Processing (bank)\" until then — there is nothing more to pay. You'll get a receipt by email once it clears.": ["Su pago bancario está en proceso y se acredita en 3 a 5 días hábiles. Hasta entonces sus facturas dicen \"En proceso (banco)\" — no tiene que pagar nada más. Recibirá un recibo por correo cuando se acredite.", "Seu pagamento bancário está em processamento e compensa em 3 a 5 dias úteis. Até lá, suas faturas mostram \"Em processamento (banco)\" — não há mais nada a pagar. Você receberá um recibo por e-mail quando compensar.", "Votre paiement bancaire est en traitement et sera réglé d'ici 3 à 5 jours ouvrables. D'ici là, vos factures indiquent « En traitement (banque) » — il n'y a rien de plus à payer. Vous recevrez un reçu par courriel une fois le paiement réglé.", "Peman labank ou ap trete, l ap pase nan 3 a 5 jou ouvrab. Jiska lè sa a, fakti ou yo ap make \"Ap trete (bank)\" — ou pa gen anyen ankò pou peye. W ap resevwa yon resi pa imel lè l fin pase."],
  "Your payment has been processed successfully.": ["Su pago se procesó correctamente.", "Seu pagamento foi processado com sucesso.", "Votre paiement a été traité avec succès.", "Peman ou an pase san pwoblèm."],
  "Amount (processing)": ["Monto (en proceso)", "Valor (em processamento)", "Montant (en traitement)", "Kantite (ap trete)"],
  "Amount Paid": ["Monto pagado", "Valor pago", "Montant payé", "Kantite ou peye"],
  "Charges Paid": ["Cargos pagados", "Cobranças pagas", "Frais payés", "Frè ki peye"],
  "Receipt #": ["Recibo n.º", "Recibo nº", "Reçu n°", "Nimewo resi"],
  "Transaction ID": ["ID de transacción", "ID da transação", "N° de transaction", "ID tranzaksyon"],
  "Payment Date": ["Fecha de pago", "Data do pagamento", "Date du paiement", "Dat peman"],
  "Remaining Balance": ["Saldo restante", "Saldo restante", "Solde restant", "Balans ki rete"],
  "Payment Review": ["Revisión del pago", "Revisão do pagamento", "Révision du paiement", "Revizyon peman"],
  "Review your selected charges before payment.": ["Revise los cargos seleccionados antes de pagar.", "Revise as cobranças selecionadas antes de pagar.", "Vérifiez les frais sélectionnés avant de payer.", "Revize frè ou chwazi yo anvan ou peye."],
  "Selected Charges": ["Cargos seleccionados", "Cobranças selecionadas", "Frais sélectionnés", "Frè ou chwazi"],
  "No selected charges found.": ["No se encontraron cargos seleccionados.", "Nenhuma cobrança selecionada encontrada.", "Aucuns frais sélectionnés trouvés.", "Nou pa jwenn frè ou chwazi yo."],
  "Go to Dashboard to Pay": ["Ir al panel para pagar", "Ir ao painel para pagar", "Aller au tableau de bord pour payer", "Ale nan tablo a pou peye"],

  // ---- Pay invoice (link without login) ----
  "Could not load this payment link.": ["No se pudo cargar este enlace de pago.", "Não foi possível carregar este link de pagamento.", "Impossible de charger ce lien de paiement.", "Nou pa t kapab chaje lyen peman sa a."],
  "{park} — Pay Invoice": ["{park} — Pagar factura", "{park} — Pagar fatura", "{park} — Payer la facture", "{park} — Peye fakti"],
  "✅ Payment received — thank you!": ["✅ Pago recibido — ¡gracias!", "✅ Pagamento recebido — obrigado!", "✅ Paiement reçu — merci!", "✅ Nou resevwa peman an — mèsi!"],
  "Payment was cancelled. You can try again below.": ["El pago se canceló. Puede intentarlo de nuevo abajo.", "O pagamento foi cancelado. Você pode tentar de novo abaixo.", "Le paiement a été annulé. Vous pouvez réessayer ci-dessous.", "Peman an anile. Ou ka eseye ankò anba a."],
  "A bank payment for this invoice is processing (3–5 business days) — nothing to pay right now.": ["Hay un pago bancario de esta factura en proceso (3 a 5 días hábiles) — no hay nada que pagar ahora.", "Há um pagamento bancário desta fatura em processamento (3 a 5 dias úteis) — nada a pagar agora.", "Un paiement bancaire pour cette facture est en traitement (3 à 5 jours ouvrables) — rien à payer pour l'instant.", "Yon peman labank pou fakti sa a ap trete (3 a 5 jou ouvrab) — pa gen anyen pou peye kounye a."],
  "Upcoming — the {month} invoice is available to pay on {date}.": ["Próxima — la factura de {month} estará disponible para pagar el {date}.", "Próxima — a fatura de {month} estará disponível para pagamento em {date}.", "À venir — la facture de {month} sera payable à partir du {date}.", "K ap vini — fakti pou {month} ap disponib pou peye apati {date}."],
  "Being prepared — the {month} invoice is available to pay on {date}.": ["En preparación — la factura de {month} estará disponible para pagar el {date}.", "Em preparação — a fatura de {month} estará disponível para pagamento em {date}.", "En préparation — la facture de {month} sera payable à partir du {date}.", "Ap prepare — fakti pou {month} ap disponib pou peye apati {date}."],
  "This is next month's invoice (due {date}). Paying it now is optional — you are paying ahead.": ["Esta es la factura del próximo mes (vence el {date}). Pagarla ahora es opcional — está pagando por adelantado.", "Esta é a fatura do próximo mês (vence em {date}). Pagar agora é opcional — você está pagando adiantado.", "Il s'agit de la facture du mois prochain (due le {date}). La payer maintenant est facultatif — vous payez d'avance.", "Sa a se fakti mwa pwochen an (dat limit {date}). Ou pa oblije peye l kounye a — w ap peye davans."],
  "You're paying an outstanding balance for a resident at {park}. For their privacy, this page only shows the amount due — not their name or full account.": ["Está pagando un saldo pendiente de un residente de {park}. Por su privacidad, esta página solo muestra el monto a pagar — no su nombre ni toda la cuenta.", "Você está pagando um saldo em aberto de um morador do {park}. Por privacidade, esta página mostra só o valor a pagar — não o nome nem a conta completa.", "Vous payez un solde dû pour un résident de {park}. Pour protéger sa vie privée, cette page affiche seulement le montant dû — ni son nom ni son compte complet.", "W ap peye yon balans yon rezidan {park} dwe. Pou pwoteje vi prive li, paj sa a montre sèlman kantite lajan ki dwe a — li pa montre non l ni tout kont li."],
  "Lot:": ["Lote:", "Lote:", "Terrain :", "Espas:"],
  "Invoice:": ["Factura:", "Fatura:", "Facture :", "Fakti:"],
  "Due Date:": ["Vence:", "Vencimento:", "Échéance :", "Dat limit:"],
  "Pay {amount}": ["Pagar {amount}", "Pagar {amount}", "Payer {amount}", "Peye {amount}"],
  "✅ This invoice has already been paid — nothing due.": ["✅ Esta factura ya está pagada — no hay nada pendiente.", "✅ Esta fatura já foi paga — nada a pagar.", "✅ Cette facture a déjà été payée — rien à payer.", "✅ Fakti sa a deja peye — pa gen anyen pou peye."],
  "Powered by MelyOS.io": ["Con la tecnología de MelyOS.io", "Desenvolvido por MelyOS.io", "Propulsé par MelyOS.io", "Se MelyOS.io ki fè l mache"],

  // ---- Server messages (exact text from the API routes) ----
  "Invalid email or password. If you've tried several times, wait 15 minutes and try again.": ["Correo o contraseña incorrectos. Si lo intentó varias veces, espere 15 minutos y vuelva a intentarlo.", "E-mail ou senha incorretos. Se você tentou várias vezes, aguarde 15 minutos e tente de novo.", "Courriel ou mot de passe invalide. Si vous avez essayé plusieurs fois, attendez 15 minutes et réessayez.", "Imel oswa modpas la pa bon. Si ou eseye plizyè fwa deja, tann 15 minit epi eseye ankò."],
  "Enter email and password.": ["Escriba su correo y contraseña.", "Digite seu e-mail e senha.", "Entrez votre courriel et votre mot de passe.", "Mete imel ak modpas ou."],
  "Your portal access has ended. Please contact the park office if you believe this is a mistake.": ["Su acceso al portal terminó. Comuníquese con la oficina del parque si cree que es un error.", "Seu acesso ao portal terminou. Fale com o escritório do parque se achar que é um engano.", "Votre accès au portail a pris fin. Communiquez avec le bureau du parc si vous croyez qu'il s'agit d'une erreur.", "Aksè ou nan pòtay la fini. Tanpri kontakte biwo pak la si ou panse se yon erè."],
  "Please pay your {month} invoice ({amount}) before accessing your resident portal.": ["Pague su factura de {month} ({amount}) antes de entrar a su portal de residentes.", "Pague sua fatura de {month} ({amount}) antes de acessar o portal do morador.", "Veuillez payer votre facture de {month} ({amount}) avant d'accéder à votre portail des résidents.", "Tanpri peye fakti pou {month} ({amount}) anvan ou antre nan pòtay rezidan ou."],
  "Email is required": ["El correo es obligatorio", "O e-mail é obrigatório", "Le courriel est obligatoire", "Imel la obligatwa"],
  "Reset link is invalid or expired.": ["El enlace no es válido o venció.", "O link é inválido ou expirou.", "Le lien de réinitialisation est invalide ou expiré.", "Lyen pou chanje modpas la pa bon oswa li ekspire."],
  "Token and password are required": ["Faltan el enlace o la contraseña", "Faltam o link ou a senha", "Le jeton et le mot de passe sont obligatoires", "Lyen an ak modpas la obligatwa"],
  "Too many tries. Please wait a few minutes.": ["Demasiados intentos. Espere unos minutos.", "Tentativas demais. Aguarde alguns minutos.", "Trop de tentatives. Veuillez patienter quelques minutes.", "Twòp esè. Tanpri tann kèk minit."],
  "Not authenticated.": ["Su sesión terminó. Inicie sesión de nuevo.", "Sua sessão terminou. Entre novamente.", "Votre session a pris fin. Veuillez vous reconnecter.", "Sesyon ou fini. Tanpri konekte ankò."],
  "Read only: you are viewing the portal as this resident. Nothing can be paid, signed or changed.": ["Solo lectura: está viendo el portal como este residente. No se puede pagar, firmar ni cambiar nada.", "Somente leitura: você está vendo o portal como este morador. Nada pode ser pago, assinado ou alterado.", "Lecture seule : vous consultez le portail en tant que ce résident. Rien ne peut être payé, signé ni modifié.", "Li sèlman: w ap gade pòtay la tankou rezidan sa a. Ou pa ka peye, siyen ni chanje anyen."],
  "No pending balance found.": ["No hay saldo pendiente.", "Não há saldo em aberto.", "Aucun solde à payer.", "Pa gen balans pou peye."],
  "There is no invoice to pay ahead right now.": ["Ahora no hay ninguna factura para pagar por adelantado.", "Não há fatura para pagar adiantado agora.", "Il n'y a aucune facture à payer d'avance pour l'instant.", "Pa gen fakti pou peye davans kounye a."],
  "Bank payment is not available at this park. Please pay by card.": ["Este parque no acepta pagos bancarios. Pague con tarjeta, por favor.", "Este parque não aceita pagamento bancário. Pague com cartão, por favor.", "Le paiement par banque n'est pas offert dans ce parc. Veuillez payer par carte.", "Peman ak bank pa disponib nan pak sa a. Tanpri peye ak kat."],
  "Bank payment is available on balances of {amount} or more. Please pay by card.": ["El pago bancario está disponible para saldos de {amount} o más. Pague con tarjeta, por favor.", "O pagamento bancário está disponível para saldos de {amount} ou mais. Pague com cartão, por favor.", "Le paiement par banque est offert pour les soldes de {amount} ou plus. Veuillez payer par carte.", "Peman ak bank disponib pou balans {amount} oswa plis. Tanpri peye ak kat."],
  "Your invoice is being prepared — it will be available to pay on {date}.": ["Su factura está en preparación — estará disponible para pagar el {date}.", "Sua fatura está em preparação — estará disponível para pagamento em {date}.", "Votre facture est en préparation — elle sera payable à partir du {date}.", "N ap prepare fakti ou — l ap disponib pou peye apati {date}."],
  "Available to pay on {date}.": ["Disponible para pagar el {date}.", "Disponível para pagamento em {date}.", "Payable à partir du {date}.", "Ou ka peye l apati {date}."],
  "Your electric reading is added around day {day} of the month — you can pay as soon as it's on your invoice.": ["Su lectura eléctrica se agrega alrededor del día {day} del mes — podrá pagar en cuanto aparezca en su factura.", "Sua leitura de energia é lançada por volta do dia {day} do mês — você poderá pagar assim que ela estiver na fatura.", "Votre relevé d'électricité est ajouté vers le {day} du mois — vous pouvez payer dès qu'il apparaît sur votre facture.", "Yo ajoute lekti elektrisite ou a vè {day} nan mwa a — ou ka peye depi li parèt sou fakti ou."],
  "This invoice can be paid starting {date}.": ["Esta factura se puede pagar a partir del {date}.", "Esta fatura pode ser paga a partir de {date}.", "Cette facture peut être payée à partir du {date}.", "Ou ka peye fakti sa a apati {date}."],
  "A bank payment for this invoice is already processing (3–5 business days). Nothing to pay right now.": ["Ya hay un pago bancario de esta factura en proceso (3 a 5 días hábiles). No hay nada que pagar ahora.", "Já há um pagamento bancário desta fatura em processamento (3 a 5 dias úteis). Nada a pagar agora.", "Un paiement bancaire pour cette facture est déjà en traitement (3 à 5 jours ouvrables). Rien à payer pour l'instant.", "Yon peman labank pou fakti sa a deja ap trete (3 a 5 jou ouvrab). Pa gen anyen pou peye kounye a."],
  "No balance due on this invoice.": ["Esta factura no tiene saldo pendiente.", "Esta fatura não tem saldo a pagar.", "Aucun solde à payer sur cette facture.", "Pa gen balans pou peye sou fakti sa a."],
  "This invoice has already been paid.": ["Esta factura ya está pagada.", "Esta fatura já foi paga.", "Cette facture a déjà été payée.", "Fakti sa a deja peye."],
  "Payment link not found or expired.": ["El enlace de pago no existe o venció.", "O link de pagamento não existe ou expirou.", "Lien de paiement introuvable ou expiré.", "Nou pa jwenn lyen peman an oswa li ekspire."],
  "Missing payment link token.": ["Falta el enlace de pago.", "Falta o link de pagamento.", "Le lien de paiement est manquant.", "Lyen peman an manke."],
  "Missing token.": ["Falta el enlace.", "Falta o link.", "Le lien est manquant.", "Lyen an manke."],
  "Could not create checkout session.": ["No se pudo abrir el pago.", "Não foi possível abrir o pagamento.", "Impossible de créer la session de paiement.", "Nou pa t kapab kreye sesyon peman an."],
  "Add a valid mobile number to your Resident Information first.": ["Primero agregue un número de celular válido en su información de residente.", "Primeiro adicione um número de celular válido nas suas informações de morador.", "Ajoutez d'abord un numéro de cellulaire valide dans vos renseignements de résident.", "Ajoute yon nimewo selilè ki bon nan Enfòmasyon rezidan ou anvan."],
  "That email is already used by another account. Please contact the office.": ["Ese correo ya lo usa otra cuenta. Comuníquese con la oficina.", "Esse e-mail já é usado por outra conta. Fale com o escritório.", "Ce courriel est déjà utilisé par un autre compte. Veuillez communiquer avec le bureau.", "Yon lòt kont deja ap sèvi ak imel sa a. Tanpri kontakte biwo a."],
  "Please enter a valid email address.": ["Escriba un correo electrónico válido.", "Digite um e-mail válido.", "Veuillez entrer une adresse courriel valide.", "Tanpri mete yon adrès imel ki bon."],
  "Could not save your information.": ["No se pudo guardar su información.", "Não foi possível salvar suas informações.", "Impossible d'enregistrer vos renseignements.", "Nou pa t kapab anrejistre enfòmasyon ou yo."],
  "Bank autopay isn't available yet. Please use a card for autopay, or pay by bank each month.": ["El pago automático bancario todavía no está disponible. Use una tarjeta para el pago automático, o pague con banco cada mes.", "O pagamento automático bancário ainda não está disponível. Use um cartão para o pagamento automático, ou pague com banco todo mês.", "Le paiement automatique bancaire n'est pas encore offert. Veuillez utiliser une carte pour le paiement automatique, ou payer par banque chaque mois.", "Peman otomatik labank poko disponib. Tanpri sèvi ak yon kat pou peman otomatik, oswa peye ak bank chak mwa."],
  "Your bank is still verifying the account. Please try again later, or use a card.": ["Su banco todavía está verificando la cuenta. Inténtelo más tarde o use una tarjeta.", "Seu banco ainda está verificando a conta. Tente mais tarde ou use um cartão.", "Votre banque vérifie encore le compte. Veuillez réessayer plus tard, ou utilisez une carte.", "Bank ou toujou ap verifye kont lan. Tanpri eseye ankò pita, oswa sèvi ak yon kat."],
  "This link is old. Please set up bank autopay again.": ["Este enlace es viejo. Configure de nuevo el pago automático bancario.", "Este link é antigo. Configure de novo o pagamento automático bancário.", "Ce lien est périmé. Veuillez configurer de nouveau le paiement automatique bancaire.", "Lyen sa a twò ansyen. Tanpri mete peman otomatik labank lan ankò."],
  "The bank account was not saved. Please try again.": ["La cuenta bancaria no se guardó. Inténtelo de nuevo.", "A conta bancária não foi salva. Tente novamente.", "Le compte bancaire n'a pas été enregistré. Veuillez réessayer.", "Kont labank lan pa t anrejistre. Tanpri eseye ankò."],
  "This is not a card. Please use a card here, or set up autopay by bank.": ["Esto no es una tarjeta. Use una tarjeta aquí, o configure el pago automático con banco.", "Isto não é um cartão. Use um cartão aqui, ou configure o pagamento automático com banco.", "Ce n'est pas une carte. Veuillez utiliser une carte ici, ou configurez le paiement automatique par banque.", "Sa a pa yon kat. Tanpri sèvi ak yon kat isit la, oswa mete peman otomatik ak bank."],
  "This card isn't saved on your account. Please add it again.": ["Esta tarjeta no está guardada en su cuenta. Agréguela de nuevo.", "Este cartão não está salvo na sua conta. Adicione de novo.", "Cette carte n'est pas enregistrée dans votre compte. Veuillez l'ajouter de nouveau.", "Kat sa a pa anrejistre sou kont ou. Tanpri ajoute l ankò."],
  "Card not found. Please try again.": ["No se encontró la tarjeta. Inténtelo de nuevo.", "Cartão não encontrado. Tente novamente.", "Carte introuvable. Veuillez réessayer.", "Nou pa jwenn kat la. Tanpri eseye ankò."],
  "Please accept the recurring charge authorization.": ["Acepte la autorización de cobro recurrente.", "Aceite a autorização de cobrança recorrente.", "Veuillez accepter l'autorisation de paiements récurrents.", "Tanpri aksepte otorizasyon pou peman ki repete yo."],
  "You already signed this agreement.": ["Usted ya firmó este acuerdo.", "Você já assinou este acordo.", "Vous avez déjà signé cette entente.", "Ou deja siyen akò sa a."],
  "This addendum was updated by the office. Please close it, open it again, and read the current text before signing.": ["La oficina actualizó este anexo. Ciérrelo, ábralo de nuevo y lea el texto actual antes de firmar.", "O escritório atualizou este aditivo. Feche, abra de novo e leia o texto atual antes de assinar.", "Cet avenant a été mis à jour par le bureau. Veuillez le fermer, l'ouvrir de nouveau et lire le texte actuel avant de signer.", "Biwo a mete adandòm sa a ajou. Tanpri fèmen l, louvri l ankò epi li tèks ki la kounye a anvan ou siyen."],
  "This addendum was already signed or changed. Please reload the page.": ["Este anexo ya se firmó o cambió. Vuelva a cargar la página.", "Este aditivo já foi assinado ou alterado. Recarregue a página.", "Cet avenant a déjà été signé ou modifié. Veuillez recharger la page.", "Adandòm sa a deja siyen oswa chanje. Tanpri rechaje paj la."],
  "The signed copy isn't ready. Please contact the office.": ["La copia firmada no está lista. Comuníquese con la oficina.", "A cópia assinada não está pronta. Fale com o escritório.", "La copie signée n'est pas prête. Veuillez communiquer avec le bureau.", "Kopi siyen an poko pare. Tanpri kontakte biwo a."],
  "The office withdrew this agreement.": ["La oficina retiró este acuerdo.", "O escritório retirou este acordo.", "Le bureau a retiré cette entente.", "Biwo a retire akò sa a."],
  "That photo is too large (max 10 MB).": ["La foto es demasiado grande (máximo 10 MB).", "A foto é grande demais (máximo 10 MB).", "Cette photo est trop grande (10 Mo maximum).", "Foto sa a twò gwo (10 MB maksimòm)."],
  "Only photos (JPG, PNG, WebP, HEIC).": ["Solo fotos (JPG, PNG, WebP, HEIC).", "Somente fotos (JPG, PNG, WebP, HEIC).", "Photos seulement (JPG, PNG, WebP, HEIC).", "Foto sèlman (JPG, PNG, WebP, HEIC)."],
  "Please upload a photo (JPG, PNG, WEBP, HEIC) or a PDF.": ["Suba una foto (JPG, PNG, WEBP, HEIC) o un PDF.", "Envie uma foto (JPG, PNG, WEBP, HEIC) ou um PDF.", "Veuillez téléverser une photo (JPG, PNG, WEBP, HEIC) ou un PDF.", "Tanpri voye yon foto (JPG, PNG, WEBP, HEIC) oswa yon PDF."],
  "File is empty or too large (15MB max).": ["El archivo está vacío o es demasiado grande (máximo 15 MB).", "O arquivo está vazio ou é grande demais (máximo 15 MB).", "Le fichier est vide ou trop volumineux (15 Mo maximum).", "Fichye a vid oswa li twò gwo (15 MB maksimòm)."],
  "Could not upload the photo.": ["No se pudo subir la foto.", "Não foi possível enviar a foto.", "Impossible de téléverser la photo.", "Nou pa t kapab voye foto a."],
  "Could not upload file: {detail}": ["No se pudo subir el archivo: {detail}", "Não foi possível enviar o arquivo: {detail}", "Impossible de téléverser le fichier : {detail}", "Nou pa t kapab voye fichye a: {detail}"],
  "Could not generate a link for this file.": ["No se pudo generar un enlace para este archivo.", "Não foi possível gerar um link para este arquivo.", "Impossible de créer un lien pour ce fichier.", "Nou pa t kapab fè yon lyen pou fichye sa a."],
  "Could not open the PDF.": ["No se pudo abrir el PDF.", "Não foi possível abrir o PDF.", "Impossible d'ouvrir le PDF.", "Nou pa t kapab louvri PDF la."],
  "This lease has no PDF on file.": ["Este contrato no tiene PDF registrado.", "Este contrato não tem PDF cadastrado.", "Ce bail n'a aucun PDF au dossier.", "Kontra lwaye sa a pa gen PDF ki anrejistre."],
  "Up to 10 photos per request.": ["Hasta 10 fotos por solicitud.", "Até 10 fotos por solicitação.", "Jusqu'à 10 photos par demande.", "Jiska 10 foto pou chak demann."],
  "Up to 8 photos per item.": ["Hasta 8 fotos por artículo.", "Até 8 fotos por item.", "Jusqu'à 8 photos par article.", "Jiska 8 foto pou chak atik."],
  "Not available yet.": ["Todavía no está disponible.", "Ainda não está disponível.", "Pas encore disponible.", "Poko disponib."],
  "Document not found.": ["No se encontró el documento.", "Documento não encontrado.", "Document introuvable.", "Nou pa jwenn dokiman an."],
  "Invoice not found.": ["No se encontró la factura.", "Fatura não encontrada.", "Facture introuvable.", "Nou pa jwenn fakti a."],
  "Listing not found.": ["No se encontró el anuncio.", "Anúncio não encontrado.", "Annonce introuvable.", "Nou pa jwenn anons lan."],
  "Vehicle not found.": ["No se encontró el vehículo.", "Veículo não encontrado.", "Véhicule introuvable.", "Nou pa jwenn machin nan."],
  "Occupant not found.": ["No se encontró a la persona.", "Pessoa não encontrada.", "Occupant introuvable.", "Nou pa jwenn moun nan."],
  "Request not found.": ["No se encontró la solicitud.", "Solicitação não encontrada.", "Demande introuvable.", "Nou pa jwenn demann lan."],
  "Order not found.": ["No se encontró el pedido.", "Pedido não encontrado.", "Commande introuvable.", "Nou pa jwenn kòmand lan."],
  "No lease found.": ["No se encontró un contrato.", "Nenhum contrato encontrado.", "Aucun bail trouvé.", "Nou pa jwenn okenn kontra lwaye."],
  "Lease not found.": ["No se encontró el contrato.", "Contrato não encontrado.", "Bail introuvable.", "Nou pa jwenn kontra lwaye a."],
  "Push is not set up yet.": ["Las alertas todavía no están configuradas.", "Os alertas ainda não estão configurados.", "Les alertes ne sont pas encore configurées.", "Alèt yo poko pare."],
  "Invalid subscription.": ["Suscripción no válida.", "Inscrição inválida.", "Abonnement invalide.", "Abònman an pa bon."],
  "Could not load your propane orders.": ["No se pudieron cargar sus pedidos de propano.", "Não foi possível carregar seus pedidos de propano.", "Impossible de charger vos commandes de propane.", "Nou pa t kapab chaje kòmand pwopàn ou yo."],
  // ---- Oct 29: Request the Rec Hall (src/components/RecHallCard.tsx + /api/portal/rec-hall; bell texts: ./recHallI18n.ts) ----
  "Rec Hall": ["Rec Hall", "Rec Hall", "Rec Hall", "Rec Hall"],
  "Request the Rec Hall": ["Solicitar el Rec Hall", "Solicitar o Rec Hall", "Réserver le Rec Hall", "Mande Rec Hall la"],
  "Rec Hall requests are not available yet.": ["Las solicitudes del Rec Hall todavía no están disponibles.", "As solicitações do Rec Hall ainda não estão disponíveis.", "Les demandes de Rec Hall ne sont pas encore offertes.", "Demann pou Rec Hall la poko disponib."],
  "Ask the office to reserve the {room} for your event. Free for residents — the office will approve or decline your request.": ["Pida a la oficina que le reserve el {room} para su evento. Es gratis para residentes; la oficina aprobará o rechazará su solicitud.", "Peça ao escritório para reservar o {room} para o seu evento. É gratuito para moradores; o escritório vai aprovar ou recusar sua solicitação.", "Demandez au bureau de réserver le {room} pour votre événement. Gratuit pour les résidents — le bureau approuvera ou refusera votre demande.", "Mande biwo a pou rezève {room} pou evènman ou. Se gratis pou rezidan — biwo a ap apwouve oswa refize demann ou an."],
  "Fits up to {n} people.": ["Capacidad para hasta {n} personas.", "Capacidade para até {n} pessoas.", "Capacité jusqu'à {n} personnes.", "Jiska {n} moun ka antre."],
  "Date": ["Fecha", "Data", "Date", "Dat"],
  "Start time": ["Hora de inicio", "Horário de início", "Heure de début", "Lè kòmansman"],
  "End time": ["Hora de fin", "Horário de término", "Heure de fin", "Lè fen"],
  "Already taken that day": ["Horarios ocupados ese día", "Horários ocupados nesse dia", "Déjà réservé cette journée-là", "Lè ki deja pran jou sa a"],
  "Nothing booked yet — the whole day is open.": ["Todavía no hay reservaciones: el día entero está libre.", "Ainda não há reservas: o dia inteiro está livre.", "Aucune réservation pour l'instant — toute la journée est libre.", "Poko gen rezèvasyon — tout jounen an lib."],
  "Your request": ["Su solicitud", "Sua solicitação", "Votre demande", "Demann ou"],
  "Booked": ["Reservado", "Reservado", "Réservé", "Rezève"],
  "Requested (pending)": ["Solicitado (pendiente)", "Solicitado (pendente)", "Demandé (en attente)", "Mande (an atant)"],
  "The Rec Hall is already booked for part of that time. Please choose another time.": ["El Rec Hall ya está reservado durante parte de ese horario. Elija otro horario.", "O Rec Hall já está reservado em parte desse horário. Escolha outro horário.", "Le Rec Hall est déjà réservé pendant une partie de cette période. Veuillez choisir une autre heure.", "Rec Hall la deja rezève pou yon pati nan lè sa a. Tanpri chwazi yon lòt lè."],
  "Event name": ["Nombre del evento", "Nome do evento", "Nom de l'événement", "Non evènman an"],
  "Birthday party, family gathering…": ["Fiesta de cumpleaños, reunión familiar…", "Festa de aniversário, reunião de família…", "Fête d'anniversaire, réunion de famille…", "Fèt anivèsè, reyinyon fanmi…"],
  "Number of guests": ["Número de invitados", "Número de convidados", "Nombre d'invités", "Kantite envite"],
  "Send request": ["Enviar solicitud", "Enviar solicitação", "Envoyer la demande", "Voye demann lan"],
  "Up to {n} days ahead, 7:00 AM – 11:00 PM, up to 8 hours.": ["Hasta {n} días por adelantado, de 7:00 a. m. a 11:00 p. m., máximo 8 horas.", "Até {n} dias de antecedência, das 7h às 23h, no máximo 8 horas.", "Jusqu'à {n} jours à l'avance, de 7 h à 23 h, maximum 8 heures.", "Jiska {n} jou davans, de 7è dimaten rive 11è diswa, pa plis pase 8 èdtan."],
  "Request sent ✓ The office will review it and let you know.": ["Solicitud enviada ✓ La oficina la revisará y le avisará.", "Solicitação enviada ✓ O escritório vai analisar e avisar você.", "Demande envoyée ✓ Le bureau l'examinera et vous donnera une réponse.", "Demann lan ale ✓ Biwo a ap revize l epi fè w konnen."],
  "Cancel this Rec Hall request?": ["¿Cancelar esta solicitud del Rec Hall?", "Cancelar esta solicitação do Rec Hall?", "Annuler cette demande de Rec Hall?", "Anile demann Rec Hall sa a?"],
  "My Rec Hall requests": ["Mis solicitudes del Rec Hall", "Minhas solicitações do Rec Hall", "Mes demandes de Rec Hall", "Demann Rec Hall mwen yo"],
  "Event": ["Evento", "Evento", "Événement", "Evènman"],
  "{n} guests": ["{n} invitados", "{n} convidados", "{n} invités", "{n} envite"],
  "Reason: {reason}": ["Motivo: {reason}", "Motivo: {reason}", "Motif : {reason}", "Rezon: {reason}"],
  "Cancelled by the office.": ["Cancelada por la oficina.", "Cancelada pelo escritório.", "Annulée par le bureau.", "Biwo a anile l."],
  "Requested": ["Solicitada", "Solicitada", "Demandée", "Mande"],
  "Approved": ["Aprobada", "Aprovada", "Approuvée", "Apwouve"],
  "Declined": ["Rechazada", "Recusada", "Refusée", "Refize"],
  "Cancelled": ["Cancelada", "Cancelada", "Annulée", "Anile"],
  "Completed": ["Completada", "Concluída", "Terminée", "Fini"],
  "Cancel request": ["Cancelar solicitud", "Cancelar solicitação", "Annuler la demande", "Anile demann lan"],
  "Choose a date, a start time and an end time.": ["Elija una fecha, una hora de inicio y una hora de fin.", "Escolha uma data, um horário de início e um de término.", "Choisissez une date, une heure de début et une heure de fin.", "Chwazi yon dat, yon lè kòmansman ak yon lè fen."],
  "The end time must be after the start time.": ["La hora de fin debe ser después de la hora de inicio.", "O horário de término deve ser depois do horário de início.", "L'heure de fin doit être après l'heure de début.", "Lè fen an dwe apre lè kòmansman an."],
  "The Rec Hall can be requested between 7:00 AM and 11:00 PM.": ["El Rec Hall se puede solicitar entre las 7:00 a. m. y las 11:00 p. m.", "O Rec Hall pode ser solicitado entre 7h e 23h.", "Le Rec Hall peut être réservé entre 7 h et 23 h.", "Ou ka mande Rec Hall la ant 7è dimaten ak 11è diswa."],
  "A request must be at least 30 minutes long.": ["La solicitud debe ser de al menos 30 minutos.", "A solicitação deve ter pelo menos 30 minutos.", "Une demande doit durer au moins 30 minutes.", "Yon demann dwe dire omwen 30 minit."],
  "A request can be at most 8 hours long.": ["La solicitud puede ser de máximo 8 horas.", "A solicitação pode ter no máximo 8 horas.", "Une demande peut durer au plus 8 heures.", "Yon demann ka dire pou pi plis 8 èdtan."],
  "Please choose a date and time that haven't passed.": ["Elija una fecha y hora que no hayan pasado.", "Escolha uma data e um horário que ainda não passaram.", "Veuillez choisir une date et une heure qui ne sont pas passées.", "Tanpri chwazi yon dat ak yon lè ki poko pase."],
  "You can request the Rec Hall up to 90 days ahead.": ["Puede solicitar el Rec Hall con hasta 90 días de anticipación.", "Você pode solicitar o Rec Hall com até 90 dias de antecedência.", "Vous pouvez réserver le Rec Hall jusqu'à 90 jours à l'avance.", "Ou ka mande Rec Hall la jiska 90 jou davans."],
  "Please enter the event name.": ["Escriba el nombre del evento.", "Digite o nome do evento.", "Veuillez entrer le nom de l'événement.", "Tanpri ekri non evènman an."],
  "Please enter how many guests (1 or more).": ["Indique cuántos invitados (1 o más).", "Informe quantos convidados (1 ou mais).", "Veuillez indiquer le nombre d'invités (1 ou plus).", "Tanpri mete konbyen envite (1 oswa plis)."],
  "The Rec Hall fits up to {n} people.": ["El Rec Hall tiene capacidad para hasta {n} personas.", "O Rec Hall comporta até {n} pessoas.", "Le Rec Hall peut accueillir jusqu'à {n} personnes.", "Rec Hall la ka resevwa jiska {n} moun."],
  "The Rec Hall can't be requested right now.": ["En este momento no se puede solicitar el Rec Hall.", "No momento não é possível solicitar o Rec Hall.", "Le Rec Hall ne peut pas être réservé pour l'instant.", "Ou pa ka mande Rec Hall la kounye a."],
  "You already have {n} requests waiting for the office. Please wait for an answer or cancel one.": ["Ya tiene {n} solicitudes esperando respuesta de la oficina. Espere la respuesta o cancele una.", "Você já tem {n} solicitações aguardando o escritório. Aguarde a resposta ou cancele uma.", "Vous avez déjà {n} demandes en attente auprès du bureau. Veuillez attendre une réponse ou en annuler une.", "Ou deja gen {n} demann k ap tann biwo a. Tanpri tann yon repons oswa anile youn."],
  "You already requested the Rec Hall for part of that time.": ["Usted ya solicitó el Rec Hall para parte de ese horario.", "Você já solicitou o Rec Hall para parte desse horário.", "Vous avez déjà demandé le Rec Hall pour une partie de cette période.", "Ou deja mande Rec Hall la pou yon pati nan lè sa a."],
  "This request can't be cancelled any more.": ["Esta solicitud ya no se puede cancelar.", "Esta solicitação não pode mais ser cancelada.", "Cette demande ne peut plus être annulée.", "Ou pa ka anile demann sa a ankò."],
  // Oct 29: Rec Hall rules edited by the admin (src/lib/recHall.ts normalizeRecHallRules)
  "Up to {n} days ahead, {from} – {until}, {min} minutes to {max} hours.": ["Hasta {n} días por adelantado, de {from} a {until}, de {min} minutos a {max} horas.", "Até {n} dias de antecedência, das {from} às {until}, de {min} minutos a {max} horas.", "Jusqu'à {n} jours à l'avance, de {from} à {until}, de {min} minutes à {max} heures.", "Jiska {n} jou davans, de {from} rive {until}, de {min} minit rive {max} èdtan."],
  "Request at least {n} hours before the start.": ["Solicítelo al menos {n} horas antes del inicio.", "Solicite com pelo menos {n} horas de antecedência.", "Faites la demande au moins {n} heures avant le début.", "Fè demann lan omwen {n} èdtan anvan l kòmanse."],
  "Rec Hall rules": ["Reglas del Rec Hall", "Regras do Rec Hall", "Règles du Rec Hall", "Règ Rec Hall la"],
  "The Rec Hall can be requested between {from} and {until}.": ["El Rec Hall se puede solicitar entre las {from} y las {until}.", "O Rec Hall pode ser solicitado entre {from} e {until}.", "Le Rec Hall peut être réservé entre {from} et {until}.", "Ou ka mande Rec Hall la ant {from} ak {until}."],
  "A request must be at least {n} minutes long.": ["La solicitud debe ser de al menos {n} minutos.", "A solicitação deve ter pelo menos {n} minutos.", "Une demande doit durer au moins {n} minutes.", "Yon demann dwe dire omwen {n} minit."],
  "A request can be at most {n} hours long.": ["La solicitud puede ser de máximo {n} horas.", "A solicitação pode ter no máximo {n} horas.", "Une demande peut durer au plus {n} heures.", "Yon demann ka dire pou pi plis {n} èdtan."],
  "You can request the Rec Hall up to {n} days ahead.": ["Puede solicitar el Rec Hall con hasta {n} días de anticipación.", "Você pode solicitar o Rec Hall com até {n} dias de antecedência.", "Vous pouvez réserver le Rec Hall jusqu'à {n} jours à l'avance.", "Ou ka mande Rec Hall la jiska {n} jou davans."],
  "Please request the Rec Hall at least {n} hours before it starts.": ["Solicite el Rec Hall al menos {n} horas antes de que empiece.", "Solicite o Rec Hall pelo menos {n} horas antes do início.", "Veuillez réserver le Rec Hall au moins {n} heures avant le début.", "Tanpri mande Rec Hall la omwen {n} èdtan anvan l kòmanse."],
  // ---- Oct 30: storage-only customers (reduced portal — residents/dashboard + ResidentPortalNav) ----
  "Storage space {name}": ["Espacio de almacenaje {name}", "Vaga de armazenamento {name}", "Espace d'entreposage {name}", "Espas depo {name}"],
  "My storage": ["Mi almacenaje", "Meu armazenamento", "Mon entreposage", "Depo mwen"],
  "Storage": ["Almacenaje", "Armazenamento", "Entreposage", "Depo"],
  "Storage ended": ["Almacenaje terminado", "Armazenamento encerrado", "Entreposage terminé", "Depo a fini"],
  "{amount} per month": ["{amount} al mes", "{amount} por mês", "{amount} par mois", "{amount} pa mwa"],
  "Monthly storage": ["Almacenaje mensual", "Armazenamento mensal", "Entreposage mensuel", "Depo chak mwa"],
  "Storage space:": ["Espacio de almacenaje:", "Vaga de armazenamento:", "Espace d'entreposage :", "Espas depo:"],
  "Stored:": ["Guardado:", "Guardado:", "Entreposé :", "Sa ki nan depo a:"],
  "To change or end your storage, please contact the office.": ["Para cambiar o terminar su almacenaje, comuníquese con la oficina.", "Para alterar ou encerrar seu armazenamento, entre em contato com o escritório.", "Pour modifier ou terminer votre entreposage, veuillez contacter le bureau.", "Pou chanje oswa fini depo ou, tanpri kontakte biwo a."],
  "Boat": ["Bote", "Barco", "Bateau", "Bato"],
  "Trailer": ["Remolque", "Reboque", "Remorque", "Trelè"],
  "Travel Trailer": ["Remolque de viaje", "Trailer de viagem", "Roulotte", "Trelè vwayaj"],
  "Fifth Wheel": ["Fifth Wheel", "Fifth Wheel", "Caravane à sellette", "Fifth Wheel"],
  "Vehicle": ["Vehículo", "Veículo", "Véhicule", "Machin"],
};
