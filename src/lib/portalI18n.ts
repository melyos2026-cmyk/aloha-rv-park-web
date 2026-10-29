// Oct 29 (per the owner — some residents speak only English, only Spanish or only Portuguese):
// the resident portal's language layer. English / Spanish (Latin American, "usted") / Brazilian
// Portuguese.
//
// · Keys are the English text itself, so English never changes and anything missing from the
//   es/pt dictionaries simply shows in English (nothing breaks).
// · `{name}` placeholders are filled from `vars`.
// · The chosen language lives in localStorage ("portal_lang") and, when the column exists, on
//   resident_accounts.portal_language (POST /api/portal/language — the portal works the same
//   without it). Default: the browser's language when it is Spanish or Portuguese, else English.
// · No provider needed: one small store shared by every portal page and component (the login page
//   lives outside /residents). `usePortalLang()` re-renders on change; plain `ptr()` is for code
//   outside React (e.g. the portal dialogs).
// · NOT translated on purpose: signed / hashed legal text (Resident Agreement & lease bodies, the
//   autopay / ACH / SMS authorizations that are stored as proof) and anything the park wrote
//   (rules, announcements, office notes, listing text). Money is always USD.
import { createElement, Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type PortalLang = "en" | "es" | "pt";
export const PORTAL_LANGS: { code: PortalLang; label: string; name: string }[] = [
  { code: "en", label: "EN", name: "English" },
  { code: "es", label: "ES", name: "Español" },
  { code: "pt", label: "PT", name: "Português" },
];
const STORAGE_KEY = "portal_lang";
const LOCALES: Record<PortalLang, string> = { en: "en-US", es: "es-US", pt: "pt-BR" };

const isLang = (x: unknown): x is PortalLang => x === "en" || x === "es" || x === "pt";

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
export function adoptSavedPortalLang(saved: unknown) {
  if (typeof window === "undefined" || !isLang(saved) || readStored()) return;
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
  return fill(row ? row[lang === "es" ? 0 : 1] : key, vars);
}

/** A status value from the database ("Paid", "Open"…) — "status:" entries first, then plain ones. */
export function translateStatus(lang: PortalLang, value: string | null | undefined): string {
  const v = String(value ?? "");
  if (lang === "en" || !v) return v;
  const row = DICT["status:" + v] || DICT[v];
  return row ? row[lang === "es" ? 0 : 1] : v;
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

const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Dates by locale. Accepts a Date, a timestamp, "YYYY-MM-DD" (shown as that calendar day, no
 * time-zone shift) or an ISO date-time. Anything unparseable is returned as-is.
 */
export function formatDate(lang: PortalLang, value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
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
  try { return d.toLocaleDateString(LOCALES[lang], o); } catch { return d.toLocaleDateString("en-US", o); }
}

export function formatDateTime(lang: PortalLang, value: string | number | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (value === null || value === undefined || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  try { return d.toLocaleString(LOCALES[lang], opts); } catch { return d.toLocaleString("en-US", opts); }
}

/**
 * English labels the server builds — "November 1, 2026", "Nov 1, 2026", "July 2026" — shown in the
 * resident's language. ISO dates work too. Anything else comes back unchanged.
 */
export function localizeDateLabel(lang: PortalLang, label: string | null | undefined, long = true): string {
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
  return s;
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
// Dictionary: English → [Spanish, Brazilian Portuguese]
// ---------------------------------------------------------------------------------------------
const DICT: Record<string, [string, string]> = {
  // Oct 29: resident bell notices written by lib/rvCardAutopay.ts / lib/rvBankAutopay.ts (exact text).
  "Autopay could not charge your card, so autopay was turned off. Please pay your invoice by hand, or update your card and turn autopay on again.": ["El pago automático no pudo cobrar su tarjeta, así que se desactivó. Pague su factura manualmente, o actualice su tarjeta y vuelva a activar el pago automático.", "O pagamento automático não conseguiu cobrar seu cartão, então foi desativado. Pague sua fatura manualmente, ou atualize seu cartão e ative o pagamento automático novamente."],
  "Autopay could not take your bank payment, so autopay was turned off. Please pay your invoice by hand, or set up autopay again.": ["El pago automático no pudo cobrar de su cuenta bancaria, así que se desactivó. Pague su factura manualmente, o configure el pago automático de nuevo.", "O pagamento automático não conseguiu debitar sua conta bancária, então foi desativado. Pague sua fatura manualmente, ou configure o pagamento automático novamente."],
  // ---- Shared / general ----
  "Resident Portal": ["Portal de residentes", "Portal do morador"],
  "Language": ["Idioma", "Idioma"],
  "Loading...": ["Cargando...", "Carregando..."],
  "Back to Dashboard": ["Volver al panel", "Voltar ao painel"],
  "Back": ["Volver", "Voltar"],
  "Save": ["Guardar", "Salvar"],
  "Saving...": ["Guardando...", "Salvando..."],
  "Cancel": ["Cancelar", "Cancelar"],
  "Edit": ["Editar", "Editar"],
  "Remove": ["Quitar", "Remover"],
  "Delete": ["Eliminar", "Excluir"],
  "Close": ["Cerrar", "Fechar"],
  "Dismiss": ["Descartar", "Dispensar"],
  "Yes": ["Sí", "Sim"],
  "No": ["No", "Não"],
  "OK": ["Aceptar", "OK"],
  "Please confirm": ["Confirme, por favor", "Confirme, por favor"],
  "Notice": ["Aviso", "Aviso"],
  "+ Add": ["+ Agregar", "+ Adicionar"],
  "Sign Out": ["Cerrar sesión", "Sair"],
  "Please log in again.": ["Inicie sesión de nuevo, por favor.", "Entre novamente, por favor."],
  "Something went wrong. Please try again.": ["Algo salió mal. Inténtelo de nuevo.", "Algo deu errado. Tente novamente."],
  "Something went wrong.": ["Algo salió mal.", "Algo deu errado."],
  "Could not start payment.": ["No se pudo iniciar el pago.", "Não foi possível iniciar o pagamento."],
  "Could not start payment. Please try again.": ["No se pudo iniciar el pago. Inténtelo de nuevo.", "Não foi possível iniciar o pagamento. Tente novamente."],
  "Redirecting to payment...": ["Abriendo la página de pago...", "Abrindo a página de pagamento..."],
  "Pay Now": ["Pagar ahora", "Pagar agora"],
  "Lot {name}": ["Lote {name}", "Lote {name}"],
  "Charge": ["Cargo", "Cobrança"],
  "Card": ["Tarjeta", "Cartão"],
  "The park office is notified whenever you update this information.": ["La oficina del parque recibe un aviso cada vez que usted actualiza esta información.", "O escritório do parque é avisado sempre que você atualiza estas informações."],
  "This document is in English; it is the version you sign.": ["Este documento está en inglés; es la versión que usted firma.", "Este documento está em inglês; é a versão que você assina."],
  "These documents are in English; they are the versions you signed.": ["Estos documentos están en inglés; son las versiones que usted firmó.", "Estes documentos estão em inglês; são as versões que você assinou."],
  "This authorization is in English; it is the version you agree to.": ["Esta autorización está en inglés; es la versión que usted acepta.", "Esta autorização está em inglês; é a versão que você aceita."],
  "This consent is in English; it is the version you agree to.": ["Este consentimiento está en inglés; es la versión que usted acepta.", "Este consentimento está em inglês; é a versão que você aceita."],
  "Written by the park": ["Escrito por el parque", "Escrito pelo parque"],
  "Uploading...": ["Subiendo...", "Enviando..."],

  // ---- Statuses from the database ("status:" + value; see st()) ----
  "status:Paid": ["Pagada", "Paga"],
  "status:Pending": ["Pendiente", "Pendente"],
  "status:Processing": ["En proceso", "Em processamento"],
  "Processing (bank)": ["En proceso (banco)", "Em processamento (banco)"],
  "status:Overdue": ["Vencida", "Vencida"],
  "status:Void": ["Anulada", "Anulada"],
  "status:Cancelled": ["Cancelada", "Cancelada"],
  "status:Refunded": ["Reembolsada", "Reembolsada"],
  "status:Active": ["Activo", "Ativo"],
  "status:Ended": ["Terminado", "Encerrado"],
  "status:Expired": ["Vencido", "Expirado"],
  "status:Terminated": ["Terminado", "Rescindido"],
  "status:Draft": ["Borrador", "Rascunho"],
  "status:Open": ["Abierta", "Aberta"],
  "status:In Progress": ["En progreso", "Em andamento"],
  "status:Completed": ["Completada", "Concluída"],
  "status:Closed": ["Cerrada", "Fechada"],
  "status:Resolved": ["Resuelta", "Resolvida"],
  "Low": ["Baja", "Baixa"],
  "Normal": ["Normal", "Normal"],
  "High": ["Alta", "Alta"],
  "Urgent": ["Urgente", "Urgente"],
  "Passed": ["Aprobada", "Aprovada"],
  "Needs Review": ["En revisión", "Em análise"],
  "In progress": ["En progreso", "Em andamento"],

  // ---- Language switcher ----
  "Choose your language": ["Elija su idioma", "Escolha seu idioma"],

  // ---- Dashboard: navigation ----
  "Home": ["Inicio", "Início"],
  "Payments": ["Pagos", "Pagamentos"],
  "Pay": ["Pagar", "Pagar"],
  "My lot & home": ["Mi lote y vivienda", "Meu lote e casa"],
  "My lot": ["Mi lote", "Meu lote"],
  "Household": ["Hogar", "Moradores"],
  "Requests": ["Solicitudes", "Solicitações"],
  "Messages": ["Mensajes", "Mensagens"],
  "Park info": ["Info del parque", "Info do parque"],
  "Profile & more": ["Perfil y más", "Perfil e mais"],
  "More": ["Más", "Mais"],
  "Autopay": ["Pago automático", "Pagamento automático"],
  "Charges & invoices": ["Cargos y facturas", "Cobranças e faturas"],
  "Electric usage": ["Consumo eléctrico", "Consumo de energia"],
  "Home info": ["Datos de la vivienda", "Dados da casa"],
  "Parking & pets": ["Estacionamiento y mascotas", "Estacionamento e animais"],
  "Rent-to-own": ["Alquiler con opción a compra", "Aluguel com opção de compra"],
  "Documents": ["Documentos", "Documentos"],
  "Moving out": ["Mudanza", "Mudança"],
  "Occupants": ["Ocupantes", "Ocupantes"],
  "Visitors": ["Visitantes", "Visitantes"],
  "Vehicles": ["Vehículos", "Veículos"],
  "Golf carts": ["Carritos de golf", "Carrinhos de golfe"],
  "Maintenance": ["Mantenimiento", "Manutenção"],
  "Propane": ["Propano", "Propano"],
  "Notifications": ["Notificaciones", "Notificações"],
  "Announcements": ["Anuncios", "Avisos"],
  "Call 9-1-1 first": ["Llame primero al 9-1-1", "Ligue primeiro para o 9-1-1"],
  "Park emergency line": ["Línea de emergencia del parque", "Linha de emergência do parque"],
  "Office hours": ["Horario de oficina", "Horário do escritório"],
  "Park rules": ["Reglas del parque", "Regras do parque"],
  "My information": ["Mi información", "Minhas informações"],
  "Emergency contact": ["Contacto de emergencia", "Contato de emergência"],
  "Marketplace": ["Marketplace", "Marketplace"],
  "In this section": ["En esta sección", "Nesta seção"],

  // ---- Dashboard: header / home ----
  "Welcome, {name}": ["Bienvenido(a), {name}", "Bem-vindo(a), {name}"],
  "Nothing yet.": ["Todavía no hay nada.", "Nada por enquanto."],
  "Resident not found.": ["No se encontró al residente.", "Morador não encontrado."],
  "Failed to load profile.": ["No se pudo cargar el perfil.", "Não foi possível carregar o perfil."],
  "To do here": ["Pendiente aquí", "Pendências aqui"],
  "The red number goes away as soon as each item is done.": ["El número rojo desaparece en cuanto cada cosa queda hecha.", "O número vermelho some assim que cada item é resolvido."],
  "Needs your attention": ["Requiere su atención", "Precisa da sua atenção"],
  "✓ You're all set. Nothing needs your attention right now.": ["✓ Todo está al día. No hay nada pendiente por ahora.", "✓ Tudo em dia. Nada precisa da sua atenção agora."],
  "Outstanding Balance": ["Saldo pendiente", "Saldo em aberto"],
  "{amount} overdue": ["{amount} vencido", "{amount} vencido"],
  "Next Payment (Due Date):": ["Próximo pago (fecha de vencimiento):", "Próximo pagamento (vencimento):"],
  "Grace period: {n} day, until the end of {date}. A late fee applies after that date.": ["Período de gracia: {n} día, hasta el final del {date}. Después de esa fecha se cobra un recargo por pago tardío.", "Período de carência: {n} dia, até o fim de {date}. Depois dessa data é cobrada multa por atraso."],
  "Grace period: {n} days, until the end of {date}. A late fee applies after that date.": ["Período de gracia: {n} días, hasta el final del {date}. Después de esa fecha se cobra un recargo por pago tardío.", "Período de carência: {n} dias, até o fim de {date}. Depois dessa data é cobrada multa por atraso."],
  "No grace period: a late fee applies after the due date.": ["Sin período de gracia: después de la fecha de vencimiento se cobra un recargo por pago tardío.", "Sem período de carência: depois do vencimento é cobrada multa por atraso."],
  "{amount} bank payment processing · clears in 3–5 business days": ["{amount} en pago bancario en proceso · se acredita en 3 a 5 días hábiles", "{amount} em pagamento bancário em processamento · compensa em 3 a 5 dias úteis"],
  "Next month's invoice is ready ({amount}) —": ["La factura del próximo mes ya está lista ({amount}) —", "A fatura do próximo mês já está pronta ({amount}) —"],
  "pay ahead (optional)": ["pagar por adelantado (opcional)", "pagar adiantado (opcional)"],
  "See charges": ["Ver cargos", "Ver cobranças"],
  "View all": ["Ver todo", "Ver tudo"],
  "Details": ["Detalles", "Detalhes"],
  "Open": ["Abrir", "Abrir"],
  "View": ["Ver", "Ver"],
  "{n} overdue invoice": ["{n} factura vencida", "{n} fatura vencida"],
  "{n} overdue invoices": ["{n} facturas vencidas", "{n} faturas vencidas"],
  "{amount} past due": ["{amount} vencido", "{amount} vencido"],
  "Balance due: {amount}": ["Saldo a pagar: {amount}", "Saldo a pagar: {amount}"],
  "Next payment due {date}": ["Próximo pago vence el {date}", "Próximo pagamento vence em {date}"],
  "{n} invoice to pay": ["{n} factura por pagar", "{n} fatura a pagar"],
  "{n} invoices to pay": ["{n} facturas por pagar", "{n} faturas a pagar"],
  "Autopay could not take the bank payment": ["El pago automático no pudo cobrar del banco", "O pagamento automático não conseguiu debitar do banco"],
  "Autopay could not charge your card": ["El pago automático no pudo cobrar a su tarjeta", "O pagamento automático não conseguiu cobrar no seu cartão"],
  "Pay by hand or set up autopay again": ["Pague usted mismo o vuelva a configurar el pago automático", "Pague manualmente ou configure o pagamento automático de novo"],
  "Update your card or pay by hand": ["Actualice su tarjeta o pague usted mismo", "Atualize seu cartão ou pague manualmente"],
  "Background check needed": ["Se necesita verificación de antecedentes", "Verificação de antecedentes necessária"],
  "{name} — ID received, start the check": ["{name} — identificación recibida, inicie la verificación", "{name} — documento recebido, inicie a verificação"],
  "Photo ID needed": ["Se necesita identificación con foto", "Documento com foto necessário"],
  "{name} is 18+ — upload an ID, then the background check": ["{name} tiene 18 años o más — suba una identificación y luego haga la verificación de antecedentes", "{name} tem 18 anos ou mais — envie um documento e depois faça a verificação de antecedentes"],
  "{n} household occupant": ["{n} ocupante del hogar", "{n} morador"],
  "{n} household occupants": ["{n} ocupantes del hogar", "{n} moradores"],
  "Please sign: {title}": ["Por favor firme: {title}", "Por favor assine: {title}"],
  "Review and sign it online — it takes a minute": ["Revíselo y fírmelo en línea — toma un minuto", "Revise e assine on-line — leva um minuto"],
  "Sign your Bill of Sale": ["Firme su contrato de compraventa", "Assine seu contrato de compra e venda"],
  "Your Rent-to-Own home is paid off": ["Su vivienda de alquiler con opción a compra está pagada", "Sua casa do aluguel com opção de compra está quitada"],
  "Add your home/unit info": ["Agregue los datos de su vivienda/unidad", "Adicione os dados da sua casa/unidade"],
  "Make, model and VIN / Tag #": ["Marca, modelo y VIN / número de placa", "Marca, modelo e VIN / número da placa"],
  "Add an emergency contact": ["Agregue un contacto de emergencia", "Adicione um contato de emergência"],
  "Pet shots records not provided": ["Faltan los registros de vacunas de la mascota", "Carteira de vacinação do animal não enviada"],
  "Pet": ["Mascota", "Animal"],
  "{n} propane order ready for pickup": ["{n} pedido de propano listo para recoger", "{n} pedido de propano pronto para retirada"],
  "{n} propane orders ready for pickup": ["{n} pedidos de propano listos para recoger", "{n} pedidos de propano prontos para retirada"],
  "Show the QR code to staff": ["Muestre el código QR al personal", "Mostre o código QR à equipe"],
  "{n} new notification": ["{n} notificación nueva", "{n} notificação nova"],
  "{n} new notifications": ["{n} notificaciones nuevas", "{n} notificações novas"],
  "{amount} due · {n} invoice": ["{amount} a pagar · {n} factura", "{amount} a pagar · {n} fatura"],
  "{amount} due · {n} invoices": ["{amount} a pagar · {n} facturas", "{amount} a pagar · {n} faturas"],
  "All paid up": ["Todo pagado", "Tudo pago"],
  "Next payment {date}": ["Próximo pago: {date}", "Próximo pagamento: {date}"],
  "Autopay on": ["Pago automático activado", "Pagamento automático ativado"],
  "Autopay off": ["Pago automático desactivado", "Pagamento automático desativado"],
  "bank": ["banco", "banco"],
  "card": ["tarjeta", "cartão"],
  "Home/unit info not added yet": ["Aún no ha agregado los datos de la vivienda/unidad", "Dados da casa/unidade ainda não adicionados"],
  "Rent-to-Own paid off — Bill of Sale": ["Alquiler con opción a compra pagado — contrato de compraventa", "Aluguel com opção de compra quitado — contrato de compra e venda"],
  "Rent-to-Own: {paid} of {total}": ["Alquiler con opción a compra: {paid} de {total}", "Aluguel com opção de compra: {paid} de {total}"],
  "Move-out requested: {date}": ["Mudanza solicitada: {date}", "Mudança solicitada: {date}"],
  "Electric Charge {amount}": ["Cargo eléctrico {amount}", "Cobrança de energia {amount}"],
  "{n} occupant": ["{n} ocupante", "{n} ocupante"],
  "{n} occupants": ["{n} ocupantes", "{n} ocupantes"],
  "{n} visitor": ["{n} visitante", "{n} visitante"],
  "{n} visitors": ["{n} visitantes", "{n} visitantes"],
  "{n} vehicle": ["{n} vehículo", "{n} veículo"],
  "{n} vehicles": ["{n} vehículos", "{n} veículos"],
  "{n} background check needed": ["Falta {n} verificación de antecedentes", "Falta {n} verificação de antecedentes"],
  "{n} background checks needed": ["Faltan {n} verificaciones de antecedentes", "Faltam {n} verificações de antecedentes"],
  "{n} open maintenance request": ["{n} solicitud de mantenimiento abierta", "{n} solicitação de manutenção aberta"],
  "{n} open maintenance requests": ["{n} solicitudes de mantenimiento abiertas", "{n} solicitações de manutenção abertas"],
  "{n} propane order ready": ["{n} pedido de propano listo", "{n} pedido de propano pronto"],
  "{n} propane orders ready": ["{n} pedidos de propano listos", "{n} pedidos de propano prontos"],
  "Request": ["Solicitud", "Solicitação"],
  "No messages yet": ["Aún no hay mensajes", "Nenhuma mensagem ainda"],

  // ---- Dashboard: Pay ----
  "Pay your monthly balance automatically": ["Pague su saldo mensual automáticamente", "Pague seu saldo mensal automaticamente"],
  "Rent Amount": ["Monto del alquiler", "Valor do aluguel"],
  "Due on your account now": ["Por pagar en su cuenta ahora", "A pagar na sua conta agora"],
  "Nothing due right now": ["No hay nada por pagar ahora", "Nada a pagar agora"],
  "🏦 Bank payment processing": ["🏦 Pago bancario en proceso", "🏦 Pagamento bancário em processamento"],
  "Your bank payment was received and takes 3–5 business days to clear. There is nothing to pay on these invoices meanwhile.": ["Recibimos su pago bancario; tarda de 3 a 5 días hábiles en acreditarse. Mientras tanto no tiene que pagar nada en estas facturas.", "Recebemos seu pagamento bancário; ele leva de 3 a 5 dias úteis para compensar. Enquanto isso, não há nada a pagar nestas faturas."],
  "Invoice — {month}": ["Factura — {month}", "Fatura — {month}"],
  "Upcoming": ["Próximas", "Próximas"],
  "Being prepared — available {date}": ["En preparación — disponible el {date}", "Em preparação — disponível em {date}"],
  "available to pay on {date}": ["disponible para pagar el {date}", "disponível para pagamento em {date}"],
  "Pay ahead (optional)": ["Pagar por adelantado (opcional)", "Pagar adiantado (opcional)"],
  "Next month's invoice is ready. You can pay it now if you like, or any time until its due date.": ["La factura del próximo mes ya está lista. Puede pagarla ahora si desea, o en cualquier momento antes de su vencimiento.", "A fatura do próximo mês já está pronta. Você pode pagá-la agora, se quiser, ou a qualquer momento até o vencimento."],
  "Next month's invoice is ready. You can pay it now if you like, or any time until its due date — autopay pays it on the due date.": ["La factura del próximo mes ya está lista. Puede pagarla ahora si desea, o en cualquier momento antes de su vencimiento — el pago automático la paga en la fecha de vencimiento.", "A fatura do próximo mês já está pronta. Você pode pagá-la agora, se quiser, ou a qualquer momento até o vencimento — o pagamento automático a paga no dia do vencimento."],
  "Invoice — {month} · due {date}": ["Factura — {month} · vence el {date}", "Fatura — {month} · vence em {date}"],
  "Pay ahead {amount}": ["Pagar por adelantado {amount}", "Pagar adiantado {amount}"],
  "Outstanding Charges": ["Cargos pendientes", "Cobranças em aberto"],
  "Rent + any recurring charges": ["Alquiler + cargos recurrentes", "Aluguel + cobranças recorrentes"],
  "Invoice Total": ["Total de la factura", "Total da fatura"],
  "Total Due": ["Total a pagar", "Total a pagar"],
  "Pay Online": ["Pagar en línea", "Pagar on-line"],
  "🧾 Invoices": ["🧾 Facturas", "🧾 Faturas"],
  "View your monthly invoices and charges.": ["Vea sus facturas mensuales y cargos.", "Veja suas faturas mensais e cobranças."],
  "📜 Payment History": ["📜 Historial de pagos", "📜 Histórico de pagamentos"],
  "View completed payments.": ["Vea los pagos realizados.", "Veja os pagamentos concluídos."],
  "⚡ Electric Usage": ["⚡ Consumo eléctrico", "⚡ Consumo de energia"],
  "No electric usage available yet.": ["Todavía no hay consumo eléctrico disponible.", "Ainda não há consumo de energia disponível."],
  "Billing Month": ["Mes de facturación", "Mês de cobrança"],
  "Meter Number": ["Número de medidor", "Número do medidor"],
  "This Month's Usage": ["Lectura de este mes", "Leitura deste mês"],
  "Last Month's Usage": ["Lectura del mes pasado", "Leitura do mês passado"],
  "Days of Service": ["Días de servicio", "Dias de serviço"],
  "Included kWh": ["kWh incluidos", "kWh incluídos"],
  "Billable kWh": ["kWh facturables", "kWh cobrados"],
  "Rate per kWh": ["Tarifa por kWh", "Tarifa por kWh"],
  "Electric Charge": ["Cargo eléctrico", "Cobrança de energia"],
  "📊 Electric Usage History": ["📊 Historial de consumo eléctrico", "📊 Histórico de consumo de energia"],
  "View monthly electric readings, charges, and usage history.": ["Vea las lecturas mensuales, los cargos y el historial de consumo.", "Veja as leituras mensais, as cobranças e o histórico de consumo."],
  "N/A": ["N/D", "N/D"],

  // ---- Dashboard: pay-method dialog ----
  "How would you like to pay?": ["¿Cómo desea pagar?", "Como você quer pagar?"],
  "Paying ahead": ["Pago por adelantado", "Pagamento adiantado"],
  "Balance": ["Saldo", "Saldo"],
  "Payment method": ["Forma de pago", "Forma de pagamento"],
  "Pay by bank (ACH)": ["Pagar con cuenta bancaria (ACH)", "Pagar com conta bancária (ACH)"],
  "Pay by card": ["Pagar con tarjeta", "Pagar com cartão"],
  "fee {amount}": ["cargo de {amount}", "taxa de {amount}"],
  "no fee": ["sin cargo", "sem taxa"],
  " — {amount} less than card": [" — {amount} menos que con tarjeta", " — {amount} a menos que no cartão"],
  " · clears in 3–5 business days": [" · se acredita en 3 a 5 días hábiles", " · compensa em 3 a 5 dias úteis"],
  " · paid instantly": [" · se paga al instante", " · pago na hora"],
  "Recommended · lowest fee": ["Recomendado · cargo más bajo", "Recomendado · menor taxa"],
  "Recommended": ["Recomendado", "Recomendado"],
  "Continue to pay by bank": ["Continuar para pagar con banco", "Continuar para pagar com banco"],
  "Continue to pay by card": ["Continuar para pagar con tarjeta", "Continuar para pagar com cartão"],
  "Opening secure payment…": ["Abriendo el pago seguro…", "Abrindo o pagamento seguro…"],

  // ---- Returned-payment fee (server phrase, translated) ----
  "If your bank returns a payment, {phrase}.": ["Si su banco devuelve un pago, {phrase}.", "Se o seu banco devolver um pagamento, {phrase}."],
  "a returned-payment fee of $29–$35 applies (the returned-payment processing cost plus a service charge allowed by Florida law)": ["se cobra un cargo por pago devuelto de $29 a $35 (el costo de procesar el pago devuelto más un cargo por servicio permitido por la ley de Florida)", "é cobrada uma taxa de pagamento devolvido de US$ 29 a US$ 35 (o custo de processar o pagamento devolvido mais uma taxa de serviço permitida pela lei da Flórida)"],
  "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, applies": ["se cobra un cargo por pago devuelto de {flat} o el {pct}% del monto de la factura, lo que sea mayor", "é cobrada uma taxa de pagamento devolvido de {flat} ou {pct}% do valor da fatura, o que for maior"],
  "a returned-payment fee of {flat} or {pct}% of the invoice amount, whichever is greater, up to {cap}, applies": ["se cobra un cargo por pago devuelto de {flat} o el {pct}% del monto de la factura, lo que sea mayor, hasta {cap}", "é cobrada uma taxa de pagamento devolvido de {flat} ou {pct}% do valor da fatura, o que for maior, até {cap}"],
  "a returned-payment fee of {flat} applies": ["se cobra un cargo por pago devuelto de {flat}", "é cobrada uma taxa de pagamento devolvido de {flat}"],

  // ---- Dashboard: My lot & home ----
  "🎉 Your Rent-to-Own home is fully paid off!": ["🎉 ¡Su vivienda de alquiler con opción a compra está totalmente pagada!", "🎉 Sua casa do aluguel com opção de compra está totalmente quitada!"],
  "To finalize your Bill of Sale, both you and the park need to digitally sign. Type your full legal name below to sign your side.": ["Para finalizar su contrato de compraventa, usted y el parque deben firmarlo digitalmente. Escriba abajo su nombre legal completo para firmar su parte.", "Para finalizar seu contrato de compra e venda, você e o parque precisam assinar digitalmente. Digite abaixo seu nome legal completo para assinar a sua parte."],
  "✓ You signed on {date}.": ["✓ Usted firmó el {date}.", "✓ Você assinou em {date}."],
  "Waiting on the final document to generate — refresh in a moment.": ["Esperando que se genere el documento final — actualice la página en un momento.", "Aguardando a geração do documento final — atualize a página em instantes."],
  "Waiting on the park's signature to finalize your Bill of Sale.": ["Esperando la firma del parque para finalizar su contrato de compraventa.", "Aguardando a assinatura do parque para finalizar seu contrato de compra e venda."],
  "Type your full legal name to sign": ["Escriba su nombre legal completo para firmar", "Digite seu nome legal completo para assinar"],
  "Signing...": ["Firmando...", "Assinando..."],
  "Sign Bill of Sale": ["Firmar contrato de compraventa", "Assinar contrato de compra e venda"],
  "Signed! Your Bill of Sale is finalized — find it under Documents.": ["¡Firmado! Su contrato de compraventa está finalizado — lo encontrará en Documentos.", "Assinado! Seu contrato de compra e venda foi finalizado — ele está em Documentos."],
  "Signed! Waiting on the park's signature to finalize your Bill of Sale.": ["¡Firmado! Esperando la firma del parque para finalizar su contrato de compraventa.", "Assinado! Aguardando a assinatura do parque para finalizar seu contrato de compra e venda."],
  "🏡 Rent-to-Own Plan": ["🏡 Plan de alquiler con opción a compra", "🏡 Plano de aluguel com opção de compra"],
  "{amount}/month toward your total purchase price": ["{amount}/mes a cuenta del precio total de compra", "{amount}/mês para o preço total da compra"],
  "{paid} paid of {total}": ["{paid} pagado de {total}", "{paid} pago de {total}"],
  "{amount} remaining": ["faltan {amount}", "faltam {amount}"],
  "{n} payment left": ["Queda {n} pago", "Falta {n} pagamento"],
  "{n} payments left": ["Quedan {n} pagos", "Faltam {n} pagamentos"],
  "🏠 Home/Unit Info": ["🏠 Datos de la vivienda/unidad", "🏠 Dados da casa/unidade"],
  "RV": ["RV (casa rodante)", "RV (trailer)"],
  "Park Model": ["Park Model", "Park Model"],
  "Mobile Home": ["Casa móvil", "Casa móvel"],
  "Other": ["Otro", "Outro"],
  "Make": ["Marca", "Marca"],
  "Model": ["Modelo", "Modelo"],
  "Year": ["Año", "Ano"],
  "Length (ft)": ["Largo (pies)", "Comprimento (pés)"],
  "Width (ft) — optional": ["Ancho (pies) — opcional", "Largura (pés) — opcional"],
  "VIN / Tag #": ["VIN / número de placa", "VIN / número da placa"],
  "{n} ft": ["{n} pies", "{n} pés"],
  "Length not set": ["Largo sin indicar", "Comprimento não informado"],
  "VIN / Tag #: {value}": ["VIN / placa: {value}", "VIN / placa: {value}"],
  "RV info saved.": ["Datos guardados.", "Dados salvos."],
  "Could not save RV info: {detail}": ["No se pudieron guardar los datos: {detail}", "Não foi possível salvar os dados: {detail}"],
  "Could not save RV info (unexpected error): {detail}": ["No se pudieron guardar los datos (error inesperado): {detail}", "Não foi possível salvar os dados (erro inesperado): {detail}"],
  "🅿️ Parking & Pets": ["🅿️ Estacionamiento y mascotas", "🅿️ Estacionamento e animais"],
  "Edit Pets": ["Editar mascotas", "Editar animais"],
  "Parking:": ["Estacionamiento:", "Estacionamento:"],
  "{n} space(s)": ["{n} espacio(s)", "{n} vaga(s)"],
  "Designated": ["Asignado", "Designada"],
  "Not provided": ["No incluido", "Não incluído"],
  "Pets:": ["Mascotas:", "Animais:"],
  "{n} pet(s)": ["{n} mascota(s)", "{n} animal(is)"],
  "Not permitted": ["No permitidas", "Não permitidos"],
  "Pet {n}": ["Mascota {n}", "Animal {n}"],
  "{n} lbs": ["{n} lb", "{n} lb"],
  "Shots records provided": ["Registros de vacunas entregados", "Carteira de vacinação entregue"],
  "Shots records not provided": ["Faltan los registros de vacunas", "Carteira de vacinação não entregue"],
  "Parking Sticker ID#(s):": ["Número(s) de calcomanía de estacionamiento:", "Número(s) do adesivo de estacionamento:"],
  "No vehicles on file": ["No hay vehículos registrados", "Nenhum veículo cadastrado"],
  "Not yet assigned": ["Aún no asignado", "Ainda não atribuído"],
  "Gate Access Clickers Issued:": ["Controles del portón entregados:", "Controles do portão entregues:"],
  "Mailbox Keys Issued:": ["Llaves del buzón entregadas:", "Chaves da caixa de correio entregues:"],
  "Mailbox #:": ["Buzón n.º:", "Caixa de correio nº:"],
  "Lost or damaged items may be subject to a replacement fee — contact the office for details.": ["Los artículos perdidos o dañados pueden tener un cargo de reposición — consulte con la oficina.", "Itens perdidos ou danificados podem ter taxa de reposição — consulte o escritório."],
  "I have pet(s)": ["Tengo mascota(s)", "Tenho animal(is)"],
  "How many pets?": ["¿Cuántas mascotas?", "Quantos animais?"],
  "Type": ["Tipo", "Tipo"],
  "e.g. Dog, Cat": ["p. ej. perro, gato", "ex.: cachorro, gato"],
  "Name of your pet": ["Nombre de su mascota", "Nome do seu animal"],
  "Breed": ["Raza", "Raça"],
  "Color": ["Color", "Cor"],
  "Weight (lbs)": ["Peso (libras)", "Peso (libras)"],
  "Provided shots records?": ["¿Entregó los registros de vacunas?", "Entregou a carteira de vacinação?"],
  "Select...": ["Seleccione...", "Selecione..."],
  "Please select how many pets you have.": ["Indique cuántas mascotas tiene.", "Informe quantos animais você tem."],
  "Please fill in type, name, breed, color, weight, and shots records for each pet.": ["Complete tipo, nombre, raza, color, peso y registros de vacunas de cada mascota.", "Preencha tipo, nome, raça, cor, peso e carteira de vacinação de cada animal."],
  "Could not save pets: {detail}": ["No se pudieron guardar las mascotas: {detail}", "Não foi possível salvar os animais: {detail}"],
  "Could not save pets (unexpected error): {detail}": ["No se pudieron guardar las mascotas (error inesperado): {detail}", "Não foi possível salvar os animais (erro inesperado): {detail}"],
  "📄 Documents": ["📄 Documentos", "📄 Documentos"],
  "View and print your signed lease agreement and any signed resident agreements.": ["Vea e imprima su contrato de arrendamiento firmado y los acuerdos de residente firmados.", "Veja e imprima seu contrato de locação assinado e os acordos de morador assinados."],
  "🚪 Moving Out?": ["🚪 ¿Se muda?", "🚪 Vai se mudar?"],
  "Let us know your planned move-out date.": ["Indíquenos la fecha en que planea mudarse.", "Informe a data em que planeja se mudar."],
  "Requested move-out date:": ["Fecha de mudanza solicitada:", "Data de mudança solicitada:"],
  "Submitted ✓": ["Enviado ✓", "Enviado ✓"],
  "Please give us at least {n} days notice.": ["Avísenos con al menos {n} días de anticipación.", "Avise-nos com pelo menos {n} dias de antecedência."],
  "Before moving out, your outstanding balance must be $0.": ["Antes de mudarse, su saldo pendiente debe estar en $0.", "Antes de se mudar, seu saldo em aberto precisa estar zerado."],
  "Please check your email — the office will confirm your move-out date there once approved.": ["Revise su correo — la oficina le confirmará allí la fecha de mudanza cuando la apruebe.", "Verifique seu e-mail — o escritório confirmará a data da mudança por lá quando aprovar."],
  "Changed your mind, or need a different date? Cancel below, then submit a new one.": ["¿Cambió de idea o necesita otra fecha? Cancele abajo y luego envíe una nueva.", "Mudou de ideia ou precisa de outra data? Cancele abaixo e envie uma nova."],
  "Cancelling...": ["Cancelando...", "Cancelando..."],
  "Cancel Request": ["Cancelar solicitud", "Cancelar solicitação"],
  "Move-Out Date": ["Fecha de mudanza", "Data da mudança"],
  "Notes (optional)": ["Notas (opcional)", "Observações (opcional)"],
  "Sending...": ["Enviando...", "Enviando..."],
  "Submit Move-Out Date": ["Enviar fecha de mudanza", "Enviar data da mudança"],
  "Please choose a date first.": ["Primero elija una fecha.", "Escolha uma data primeiro."],
  "Error: {detail}": ["Error: {detail}", "Erro: {detail}"],
  "Cancel your move-out request? You can submit a new date afterward.": ["¿Cancelar su solicitud de mudanza? Después puede enviar una fecha nueva.", "Cancelar sua solicitação de mudança? Depois você pode enviar uma nova data."],

  // ---- Dashboard: Household ----
  "⚠️ Background Check Needed": ["⚠️ Se necesita verificación de antecedentes", "⚠️ Verificação de antecedentes necessária"],
  "1 household occupant still needs a background check paid for and started.": ["A 1 ocupante del hogar todavía le falta pagar e iniciar la verificación de antecedentes.", "1 morador ainda precisa pagar e iniciar a verificação de antecedentes."],
  "{n} household occupants still need a background check paid for and started.": ["A {n} ocupantes del hogar todavía les falta pagar e iniciar la verificación de antecedentes.", "{n} moradores ainda precisam pagar e iniciar a verificação de antecedentes."],
  "Continue to Background Check(s)": ["Continuar a la(s) verificación(es) de antecedentes", "Continuar para a(s) verificação(ões) de antecedentes"],
  "Household Occupants": ["Ocupantes del hogar", "Moradores da casa"],
  "People living here permanently. Anyone 18 or older requires a background check.": ["Personas que viven aquí de forma permanente. Toda persona de 18 años o más necesita verificación de antecedentes.", "Pessoas que moram aqui de forma permanente. Toda pessoa com 18 anos ou mais precisa de verificação de antecedentes."],
  "Full Name": ["Nombre completo", "Nome completo"],
  "Relationship": ["Parentesco", "Parentesco"],
  "Phone": ["Teléfono", "Telefone"],
  "Email": ["Correo electrónico", "E-mail"],
  "Date of Birth (required)": ["Fecha de nacimiento (obligatoria)", "Data de nascimento (obrigatória)"],
  "Social Security # (leave blank to keep the one on file)": ["Número de Seguro Social (déjelo en blanco para mantener el que ya tenemos)", "Número do Seguro Social (deixe em branco para manter o que já temos)"],
  "Social Security # (required for adults 18+)": ["Número de Seguro Social (obligatorio para mayores de 18 años)", "Número do Seguro Social (obrigatório para maiores de 18 anos)"],
  "Email is also required for adults. Stored securely; the office only sees the last 4 digits.": ["El correo también es obligatorio para adultos. Se guarda de forma segura; la oficina solo ve los últimos 4 dígitos.", "O e-mail também é obrigatório para adultos. Fica guardado com segurança; o escritório só vê os 4 últimos dígitos."],
  "Update Occupant": ["Actualizar ocupante", "Atualizar ocupante"],
  "Date of Birth: {date}": ["Fecha de nacimiento: {date}", "Data de nascimento: {date}"],
  " · Age: {n}": [" · Edad: {n}", " · Idade: {n}"],
  "Age: {n}": ["Edad: {n}", "Idade: {n}"],
  "Background check: {status}": ["Verificación de antecedentes: {status}", "Verificação de antecedentes: {status}"],
  "This person is 18 or older — a background check is required before move-in is compliant.": ["Esta persona tiene 18 años o más — se requiere verificación de antecedentes para que la mudanza cumpla con las normas.", "Esta pessoa tem 18 anos ou mais — é necessária verificação de antecedentes para a mudança estar em conformidade."],
  "Please upload a photo ID in Documents, then proceed with the background check.": ["Suba una identificación con foto en Documentos y luego continúe con la verificación de antecedentes.", "Envie um documento com foto em Documentos e depois siga com a verificação de antecedentes."],
  "Upload ID": ["Subir identificación", "Enviar documento"],
  "ID received. Now proceed with the background check.": ["Identificación recibida. Ahora continúe con la verificación de antecedentes.", "Documento recebido. Agora siga com a verificação de antecedentes."],
  "Proceed with Background Check": ["Continuar con la verificación de antecedentes", "Seguir com a verificação de antecedentes"],
  "No household occupants listed.": ["No hay ocupantes del hogar registrados.", "Nenhum morador cadastrado."],
  "Temporary guests. You can add, edit, or remove these anytime.": ["Invitados temporales. Puede agregarlos, editarlos o quitarlos cuando quiera.", "Hóspedes temporários. Você pode adicionar, editar ou remover quando quiser."],
  "Stay Start Date (required)": ["Fecha de llegada (obligatoria)", "Data de chegada (obrigatória)"],
  "Stay End Date (required)": ["Fecha de salida (obligatoria)", "Data de saída (obrigatória)"],
  "Update Visitor": ["Actualizar visitante", "Atualizar visitante"],
  "Save Visitor": ["Guardar visitante", "Salvar visitante"],
  "Stay: {start} to {end}": ["Estadía: del {start} al {end}", "Estadia: de {start} a {end}"],
  "No visitors listed.": ["No hay visitantes registrados.", "Nenhum visitante cadastrado."],
  "License Plate": ["Placa", "Placa"],
  "License State": ["Estado de la placa", "Estado da placa"],
  "Update Vehicle": ["Actualizar vehículo", "Atualizar veículo"],
  "Save Vehicle": ["Guardar vehículo", "Salvar veículo"],
  "Plate: {value}": ["Placa: {value}", "Placa: {value}"],
  "Parking Sticker ID#: {value}": ["Calcomanía de estacionamiento n.º: {value}", "Adesivo de estacionamento nº: {value}"],
  "No vehicles listed.": ["No hay vehículos registrados.", "Nenhum veículo cadastrado."],
  "Please enter a full name.": ["Escriba el nombre completo.", "Digite o nome completo."],
  "Please enter both a Stay Start Date and Stay End Date.": ["Indique la fecha de llegada y la fecha de salida.", "Informe a data de chegada e a data de saída."],
  "Please enter this person's Date of Birth.": ["Indique la fecha de nacimiento de esta persona.", "Informe a data de nascimento desta pessoa."],
  "Please enter a valid email for this adult (18+).": ["Escriba un correo válido para este adulto (18+).", "Digite um e-mail válido para este adulto (18+)."],
  "Please enter this adult's Social Security # (9 digits).": ["Escriba el número de Seguro Social de este adulto (9 dígitos).", "Digite o número do Seguro Social deste adulto (9 dígitos)."],
  "Social Security # must be 9 digits (or leave it blank to keep the one on file).": ["El número de Seguro Social debe tener 9 dígitos (o déjelo en blanco para mantener el que ya tenemos).", "O número do Seguro Social precisa ter 9 dígitos (ou deixe em branco para manter o que já temos)."],
  "Could not update visitor: {detail}": ["No se pudo actualizar: {detail}", "Não foi possível atualizar: {detail}"],
  "Could not add: {detail}": ["No se pudo agregar: {detail}", "Não foi possível adicionar: {detail}"],
  "Could not save (unexpected error): {detail}": ["No se pudo guardar (error inesperado): {detail}", "Não foi possível salvar (erro inesperado): {detail}"],
  "Remove this person?": ["¿Quitar a esta persona?", "Remover esta pessoa?"],
  "Could not remove: {detail}": ["No se pudo quitar: {detail}", "Não foi possível remover: {detail}"],
  "Could not remove (unexpected error): {detail}": ["No se pudo quitar (error inesperado): {detail}", "Não foi possível remover (erro inesperado): {detail}"],
  "Please enter a license plate.": ["Escriba la placa.", "Digite a placa."],
  "Could not update vehicle: {detail}": ["No se pudo actualizar el vehículo: {detail}", "Não foi possível atualizar o veículo: {detail}"],
  "Could not add vehicle: {detail}": ["No se pudo agregar el vehículo: {detail}", "Não foi possível adicionar o veículo: {detail}"],
  "Could not save vehicle (unexpected error): {detail}": ["No se pudo guardar el vehículo (error inesperado): {detail}", "Não foi possível salvar o veículo (erro inesperado): {detail}"],
  "Remove this vehicle?": ["¿Quitar este vehículo?", "Remover este veículo?"],
  "Could not remove vehicle: {detail}": ["No se pudo quitar el vehículo: {detail}", "Não foi possível remover o veículo: {detail}"],
  "Could not remove vehicle (unexpected error): {detail}": ["No se pudo quitar el vehículo (error inesperado): {detail}", "Não foi possível remover o veículo (erro inesperado): {detail}"],

  // ---- Dashboard: Requests ----
  "Maintenance Requests": ["Solicitudes de mantenimiento", "Solicitações de manutenção"],
  "Report issues and track maintenance progress.": ["Reporte problemas y siga el avance del mantenimiento.", "Informe problemas e acompanhe o andamento da manutenção."],
  "Maintenance requests are handled by the office — please call or message us.": ["La oficina atiende las solicitudes de mantenimiento — llámenos o escríbanos.", "O escritório cuida das solicitações de manutenção — ligue ou envie uma mensagem."],
  "Open Requests": ["Solicitudes abiertas", "Solicitações abertas"],
  "Maintenance request": ["Solicitud de mantenimiento", "Solicitação de manutenção"],
  " · {p} priority": [" · prioridad {p}", " · prioridade {p}"],
  "⛽ Propane Orders": ["⛽ Pedidos de propano", "⛽ Pedidos de propano"],
  "Propane pickup QR code": ["Código QR para recoger el propano", "Código QR para retirar o propano"],
  "{n} gallons": ["{n} galones", "{n} galões"],
  "{amount} — paid {date}": ["{amount} — pagado el {date}", "{amount} — pago em {date}"],
  "✅ Fully picked up": ["✅ Recogido por completo", "✅ Totalmente retirado"],
  "🕓 Picked up {count}/{max} — show this code to staff for the rest": ["🕓 Recogido {count}/{max} — muestre este código al personal para el resto", "🕓 Retirado {count}/{max} — mostre este código à equipe para o restante"],
  "🕓 Ready for pickup — show this code to staff": ["🕓 Listo para recoger — muestre este código al personal", "🕓 Pronto para retirada — mostre este código à equipe"],
  "Remove from my portal": ["Quitar de mi portal", "Remover do meu portal"],

  // ---- Dashboard: Messages ----
  "🔔 Notifications": ["🔔 Notificaciones", "🔔 Notificações"],
  "No announcements from the park right now.": ["El parque no tiene anuncios por ahora.", "O parque não tem avisos no momento."],

  // ---- Dashboard: Profile & more ----
  "Resident Information": ["Información del residente", "Informações do morador"],
  "Email:": ["Correo:", "E-mail:"],
  "No email": ["Sin correo", "Sem e-mail"],
  "Phone:": ["Teléfono:", "Telefone:"],
  "No phone": ["Sin teléfono", "Sem telefone"],
  "Edit Resident Information": ["Editar información del residente", "Editar informações do morador"],
  "Emergency Contact": ["Contacto de emergencia", "Contato de emergência"],
  "Name:": ["Nombre:", "Nome:"],
  "Relationship:": ["Parentesco:", "Parentesco:"],
  "None": ["Ninguno", "Nenhum"],
  "Edit Emergency Contact": ["Editar contacto de emergencia", "Editar contato de emergência"],
  "Name": ["Nombre", "Nome"],
  "e.g. Mother, Spouse, Friend": ["p. ej. madre, esposo(a), amigo(a)", "ex.: mãe, cônjuge, amigo(a)"],
  "Could not save changes: {detail}": ["No se pudieron guardar los cambios: {detail}", "Não foi possível salvar as alterações: {detail}"],
  "Could not save changes (unexpected error): {detail}": ["No se pudieron guardar los cambios (error inesperado): {detail}", "Não foi possível salvar as alterações (erro inesperado): {detail}"],
  "🛍️ Marketplace": ["🛍️ Marketplace", "🛍️ Marketplace"],
  "Buy and sell with your neighbors.": ["Compre y venda con sus vecinos.", "Compre e venda com seus vizinhos."],

  // ---- AutopaySection ----
  "Please check the box to authorize the monthly automatic charge.": ["Marque la casilla para autorizar el cobro automático mensual.", "Marque a caixa para autorizar a cobrança automática mensal."],
  "Could not start card setup.": ["No se pudo iniciar el registro de la tarjeta.", "Não foi possível iniciar o cadastro do cartão."],
  "Card field not ready.": ["El campo de la tarjeta aún no está listo.", "O campo do cartão ainda não está pronto."],
  "Could not save card.": ["No se pudo guardar la tarjeta.", "Não foi possível salvar o cartão."],
  "Could not enable autopay.": ["No se pudo activar el pago automático.", "Não foi possível ativar o pagamento automático."],
  "Recurring Charge Authorization": ["Autorización de cobro recurrente", "Autorização de cobrança recorrente"],
  "I have read and agree to this authorization.": ["He leído y acepto esta autorización.", "Li e aceito esta autorização."],
  "Save Card & Enable Autopay": ["Guardar tarjeta y activar pago automático", "Salvar cartão e ativar pagamento automático"],
  "Please check the box to authorize the automatic bank payments.": ["Marque la casilla para autorizar los pagos bancarios automáticos.", "Marque a caixa para autorizar os pagamentos bancários automáticos."],
  "Could not open the secure page. Please try again.": ["No se pudo abrir la página segura. Inténtelo de nuevo.", "Não foi possível abrir a página segura. Tente novamente."],
  "Link your checking or savings account on a <b>secure page</b> — log in to your bank, no account numbers to type.": ["Vincule su cuenta corriente o de ahorros en una <b>página segura</b> — entre a su banco, sin escribir números de cuenta.", "Vincule sua conta corrente ou poupança em uma <b>página segura</b> — entre no seu banco, sem digitar números de conta."],
  "Each payment takes <b>3–5 business days</b> to clear.": ["Cada pago tarda <b>de 3 a 5 días hábiles</b> en acreditarse.", "Cada pagamento leva <b>de 3 a 5 dias úteis</b> para compensar."],
  "Balances of <b>{amount}</b> or more are paid automatically; a smaller balance is added to the next one (you can always pay it yourself).": ["Los saldos de <b>{amount}</b> o más se pagan automáticamente; un saldo menor se suma al siguiente (siempre puede pagarlo usted mismo).", "Saldos de <b>{amount}</b> ou mais são pagos automaticamente; um saldo menor é somado ao próximo (você sempre pode pagá-lo por conta própria)."],
  "Bank debit (ACH) authorization": ["Autorización de débito bancario (ACH)", "Autorização de débito bancário (ACH)"],
  "Opening secure page...": ["Abriendo la página segura...", "Abrindo a página segura..."],
  "Link my bank & turn on autopay": ["Vincular mi banco y activar el pago automático", "Vincular meu banco e ativar o pagamento automático"],
  "Bank account": ["Cuenta bancaria", "Conta bancária"],
  "{amount} fee": ["Cargo de {amount}", "Taxa de {amount}"],
  "No fee": ["Sin cargo", "Sem taxa"],
  "on {amount}": ["sobre {amount}", "sobre {amount}"],
  "{amount} less than card": ["{amount} menos que con tarjeta", "{amount} a menos que no cartão"],
  "clears in 3–5 business days": ["se acredita en 3 a 5 días hábiles", "compensa em 3 a 5 dias úteis"],
  "charged instantly": ["se cobra al instante", "cobrado na hora"],
  "Bank autopay is then turned off.": ["En ese caso, el pago automático bancario se desactiva.", "Nesse caso, o pagamento automático bancário é desativado."],
  "Bank autopay was not turned on.": ["El pago automático bancario no se activó.", "O pagamento automático bancário não foi ativado."],
  "Autopay is on with your bank account ending in {last4}.": ["El pago automático está activado con su cuenta bancaria terminada en {last4}.", "O pagamento automático está ativado com sua conta bancária com final {last4}."],
  "Could not save the bank account.": ["No se pudo guardar la cuenta bancaria.", "Não foi possível salvar a conta bancária."],
  "Could not save the bank account. Please try again.": ["No se pudo guardar la cuenta bancaria. Inténtelo de nuevo.", "Não foi possível salvar a conta bancária. Tente novamente."],
  "Autopay is on": ["El pago automático está activado", "O pagamento automático está ativado"],
  "Bank account ending in {last4} — your balance is paid from your bank automatically each month (clears in 3–5 business days).": ["Cuenta bancaria terminada en {last4} — su saldo se paga automáticamente desde su banco cada mes (se acredita en 3 a 5 días hábiles).", "Conta bancária com final {last4} — seu saldo é pago automaticamente pelo seu banco todo mês (compensa em 3 a 5 dias úteis)."],
  "Card ending in {last4}": ["Tarjeta terminada en {last4}", "Cartão com final {last4}"],
  "Card on file": ["Tarjeta registrada", "Cartão cadastrado"],
  "Saved payment method": ["Forma de pago guardada", "Forma de pagamento salva"],
  "{method} — your balance will be charged automatically each month.": ["{method} — su saldo se cobrará automáticamente cada mes.", "{method} — seu saldo será cobrado automaticamente todo mês."],
  "The park has paused bank payments, so autopay will not take payments from your bank until they are turned back on. Please pay your balance yourself meanwhile, or turn off autopay and set it up with a card.": ["El parque pausó los pagos bancarios, así que el pago automático no cobrará de su banco hasta que se vuelvan a activar. Mientras tanto, pague su saldo usted mismo, o desactive el pago automático y configúrelo con una tarjeta.", "O parque pausou os pagamentos bancários, então o pagamento automático não vai debitar do seu banco até que sejam reativados. Enquanto isso, pague seu saldo por conta própria, ou desative o pagamento automático e configure com um cartão."],
  "Bank debit authorization accepted on {date}.": ["Autorización de débito bancario aceptada el {date}.", "Autorização de débito bancário aceita em {date}."],
  "Recurring charge authorization accepted on {date}.": ["Autorización de cobro recurrente aceptada el {date}.", "Autorização de cobrança recorrente aceita em {date}."],
  "Switch autopay to your bank account": ["Cambiar el pago automático a su cuenta bancaria", "Mudar o pagamento automático para sua conta bancária"],
  "Pay less with your bank.": ["Pague menos con su banco.", "Pague menos com seu banco."],
  "On {amount} the fee is {ach} by bank vs {card} by card.": ["Sobre {amount}, el cargo es {ach} con banco frente a {card} con tarjeta.", "Sobre {amount}, a taxa é {ach} no banco contra {card} no cartão."],
  "Bank autopay is available.": ["El pago automático bancario está disponible.", "O pagamento automático bancário está disponível."],
  "Switch to bank autopay": ["Cambiar a pago automático bancario", "Mudar para pagamento automático bancário"],
  "Turning off...": ["Desactivando...", "Desativando..."],
  "Turn Off Autopay": ["Desactivar pago automático", "Desativar pagamento automático"],

  // ---- BankPayBanner ----
  "New: pay by bank": ["Nuevo: pague con su banco", "Novidade: pague com seu banco"],
  "🏦 New: pay by bank — lower fee than card": ["🏦 Nuevo: pague con su banco — cargo más bajo que con tarjeta", "🏦 Novidade: pague com seu banco — taxa menor que no cartão"],
  "You can now pay straight from your checking or savings account.": ["Ahora puede pagar directamente desde su cuenta corriente o de ahorros.", "Agora você pode pagar direto da sua conta corrente ou poupança."],
  "On {amount} the fee is {ach} by bank instead of {card} by card.": ["Sobre {amount}, el cargo es {ach} con banco en lugar de {card} con tarjeta.", "Sobre {amount}, a taxa é {ach} no banco em vez de {card} no cartão."],
  "The bank fee is {achPct}% (at most {achMax}), the card fee {cardPct}%.": ["El cargo bancario es {achPct}% (como máximo {achMax}); el de tarjeta, {cardPct}%.", "A taxa bancária é {achPct}% (no máximo {achMax}); a do cartão, {cardPct}%."],
  "No fee either way.": ["Sin cargo en ningún caso.", "Sem taxa em nenhum dos casos."],
  "Bank payments take 3–5 business days to clear.": ["Los pagos bancarios tardan de 3 a 5 días hábiles en acreditarse.", "Os pagamentos bancários levam de 3 a 5 dias úteis para compensar."],
  "Pay by bank": ["Pagar con banco", "Pagar com banco"],
  "Set up bank autopay": ["Configurar pago automático bancario", "Configurar pagamento automático bancário"],

  // ---- ParkInfo ----
  "Call {phone}": ["Llamar al {phone}", "Ligar para {phone}"],
  "Open now": ["Abierto ahora", "Aberto agora"],
  "Closed now": ["Cerrado ahora", "Fechado agora"],
  "Call the office for current office hours.": ["Llame a la oficina para conocer el horario actual.", "Ligue para o escritório para saber o horário atual."],
  "Call the office for current office hours at {phone}.": ["Llame a la oficina al {phone} para conocer el horario actual.", "Ligue para o escritório no {phone} para saber o horário atual."],
  " (today)": [" (hoy)", " (hoje)"],
  "Closed": ["Cerrado", "Fechado"],
  "Eastern Time": ["Hora del Este", "Horário do Leste (EUA)"],
  "Call 911": ["Llamar al 911", "Ligar para o 911"],
  "Park info could not be loaded. Please try again later.": ["No se pudo cargar la información del parque. Inténtelo más tarde.", "Não foi possível carregar as informações do parque. Tente mais tarde."],
  "For anything life-threatening, call 911 before anything else. Then also notify the park": ["Ante cualquier peligro para la vida, llame primero al 911. Después avise también al parque", "Em qualquer situação de risco à vida, ligue primeiro para o 911. Depois avise também o parque"],
  " at ": [" al ", " no "],
  " so staff can meet responders and guide them to your site.": [" para que el personal reciba a los servicios de emergencia y los guíe hasta su lote.", " para que a equipe receba o socorro e o guie até o seu lote."],
  "Call the park's emergency line": ["Llame a la línea de emergencia del parque", "Ligue para a linha de emergência do parque"],
  "For urgent problems at your site that are not life-threatening.": ["Para problemas urgentes en su lote que no ponen en peligro la vida.", "Para problemas urgentes no seu lote que não representam risco à vida."],
  " This is the office number.": [" Es el número de la oficina.", " É o número do escritório."],
  "Office:": ["Oficina:", "Escritório:"],
  "Call the office": ["Llamar a la oficina", "Ligar para o escritório"],
  "After hours:": ["Fuera de horario:", "Fora do horário:"],
  "Real emergencies are covered above.": ["Las emergencias reales están explicadas arriba.", "As emergências reais estão explicadas acima."],
  "Emergency & office hours": ["Emergencias y horario de oficina", "Emergências e horário do escritório"],
  "Today:": ["Hoy:", "Hoje:"],
  "Call the office for office hours.": ["Llame a la oficina para conocer el horario.", "Ligue para o escritório para saber o horário."],
  "Fire, medical, crime or a strong gas smell: call 911 first.": ["Incendio, emergencia médica, delito o fuerte olor a gas: llame primero al 911.", "Incêndio, emergência médica, crime ou forte cheiro de gás: ligue primeiro para o 911."],
  "What to do & park rules →": ["Qué hacer y reglas del parque →", "O que fazer e regras do parque →"],

  "Non-emergency calls after office hours have a {fee} inconvenience fee.": ["Las llamadas que no son emergencias fuera del horario de oficina tienen un cargo de {fee} por la molestia.", "Ligações que não são emergência fora do horário do escritório têm uma taxa de {fee}."],
  // Standard MelyOS emergency texts (src/lib/portalInfo.ts DEFAULT_EMERGENCIES) — translated only
  // while the park hasn't changed them; a park's own wording shows as written.
  "Fire or smoke": ["Incendio o humo", "Incêndio ou fumaça"],
  "Get everyone out and away from the RV or home, then call 911. Do not go back inside. Give the park's address and your lot number.": ["Saque a todos y aléjense del RV o la vivienda; luego llame al 911. No vuelva a entrar. Dé la dirección del parque y su número de lote.", "Tire todos e afaste-se do RV ou da casa; depois ligue para o 911. Não volte para dentro. Informe o endereço do parque e o número do seu lote."],
  "Medical emergency": ["Emergencia médica", "Emergência médica"],
  "Someone is hurt, not breathing, has chest pain or is unconscious: call 911 right away and follow the dispatcher's instructions. Give the park's address and your lot number.": ["Si alguien está herido, no respira, tiene dolor en el pecho o está inconsciente: llame al 911 de inmediato y siga las instrucciones de la operadora. Dé la dirección del parque y su número de lote.", "Se alguém está ferido, não respira, tem dor no peito ou está inconsciente: ligue para o 911 imediatamente e siga as instruções do atendente. Informe o endereço do parque e o número do seu lote."],
  "Crime in progress, violence or someone in danger": ["Delito en curso, violencia o alguien en peligro", "Crime em andamento, violência ou alguém em perigo"],
  "Get to a safe place and call 911. Do not confront anyone.": ["Vaya a un lugar seguro y llame al 911. No enfrente a nadie.", "Vá para um lugar seguro e ligue para o 911. Não confronte ninguém."],
  "Strong gas smell or propane leak": ["Fuerte olor a gas o fuga de propano", "Forte cheiro de gás ou vazamento de propano"],
  "Leave the area first. Do not use flames, light switches, phones or anything that can spark near it. From a safe place, upwind, call 911.": ["Primero salga del área. No use fuego, interruptores de luz, teléfonos ni nada que pueda hacer chispa cerca. Desde un lugar seguro, en contra del viento, llame al 911.", "Primeiro saia da área. Não use fogo, interruptores, telefones nem nada que possa soltar faísca por perto. De um lugar seguro, contra o vento, ligue para o 911."],
  "Car accident with injuries": ["Accidente de auto con heridos", "Acidente de carro com feridos"],
  "Call 911. Do not move anyone who is hurt unless they are in immediate danger.": ["Llame al 911. No mueva a ningún herido a menos que esté en peligro inmediato.", "Ligue para o 911. Não mova nenhum ferido, a não ser que esteja em perigo imediato."],
  "Severe weather with immediate danger": ["Mal tiempo con peligro inmediato", "Tempo severo com perigo imediato"],
  "Tornado warning or water flooding inside your RV: go to a sturdy building or public shelter now — an RV is not safe shelter. Call 911 if anyone is trapped or in danger.": ["Alerta de tornado o agua inundando su RV: vaya ahora a un edificio sólido o a un refugio público — un RV no es un refugio seguro. Llame al 911 si alguien está atrapado o en peligro.", "Alerta de tornado ou água inundando seu RV: vá agora para um prédio firme ou um abrigo público — um RV não é abrigo seguro. Ligue para o 911 se alguém estiver preso ou em perigo."],
  "Downed or sparking power line": ["Cable eléctrico caído o echando chispas", "Fio elétrico caído ou soltando faíscas"],
  "Stay at least 30 feet away and keep others away. Never touch the line or anything it is touching. Call 911.": ["Manténgase a por lo menos 30 pies (9 metros) y mantenga alejados a los demás. Nunca toque el cable ni nada que esté tocando. Llame al 911.", "Fique a pelo menos 30 pés (9 metros) e mantenha os outros longe. Nunca toque no fio nem em nada que ele esteja tocando. Ligue para o 911."],
  "Power out at your site": ["Sin electricidad en su lote", "Sem energia no seu lote"],
  "Check whether your neighbors also lost power. If only your site is out, reset the breaker on your pedestal and your RV's main breaker. If that does not fix it, call the park's emergency line. If the whole park is out, staff are already working on it.": ["Fíjese si sus vecinos también se quedaron sin luz. Si solo es su lote, reinicie el breaker de su pedestal y el breaker principal de su RV. Si eso no lo resuelve, llame a la línea de emergencia del parque. Si todo el parque está sin luz, el personal ya está trabajando en ello.", "Veja se os vizinhos também ficaram sem energia. Se for só o seu lote, religue o disjuntor do seu pedestal e o disjuntor principal do seu RV. Se não resolver, ligue para a linha de emergência do parque. Se o parque inteiro estiver sem energia, a equipe já está cuidando disso."],
  "No water or a water leak": ["Sin agua o con una fuga de agua", "Sem água ou com vazamento de água"],
  "Check that your spigot valve is open and your hose is not kinked. If water is gushing or leaking from a park line, call the park's emergency line right away. If the whole park is out, staff are already working on it.": ["Revise que la llave de su toma esté abierta y que la manguera no esté doblada. Si sale mucha agua o hay una fuga en una tubería del parque, llame de inmediato a la línea de emergencia del parque. Si todo el parque está sin agua, el personal ya está trabajando en ello.", "Verifique se o registro da sua torneira está aberto e se a mangueira não está dobrada. Se a água estiver jorrando ou vazando de uma tubulação do parque, ligue imediatamente para a linha de emergência do parque. Se o parque inteiro estiver sem água, a equipe já está cuidando disso."],
  "Sewer or plumbing backup": ["Desagüe o tubería tapada", "Esgoto ou encanamento entupido"],
  "Stop using water and do not flush. Close the water at your spigot. If sewage is coming out of the park's sewer connection or flooding your site, call the park's emergency line. A clog inside your RV or home is the resident's responsibility.": ["Deje de usar agua y no descargue el inodoro. Cierre el agua en su toma. Si sale agua negra de la conexión de desagüe del parque o se inunda su lote, llame a la línea de emergencia del parque. Una obstrucción dentro de su RV o vivienda es responsabilidad del residente.", "Pare de usar água e não dê descarga. Feche a água na sua torneira. Se o esgoto estiver saindo pela ligação de esgoto do parque ou alagando seu lote, ligue para a linha de emergência do parque. Um entupimento dentro do seu RV ou casa é responsabilidade do morador."],
  "Small propane issue (no smell of danger)": ["Problema menor con el propano (sin olor peligroso)", "Problema pequeno com o propano (sem cheiro de perigo)"],
  "Close the tank valve and do not use the appliance. Call the park's emergency line. If you smell gas strongly, leave the area and call 911 instead.": ["Cierre la válvula del tanque y no use el aparato. Llame a la línea de emergencia del parque. Si huele mucho a gas, salga del área y llame al 911.", "Feche a válvula do botijão e não use o aparelho. Ligue para a linha de emergência do parque. Se sentir cheiro forte de gás, saia da área e ligue para o 911."],
  "Fallen tree or storm damage": ["Árbol caído o daños por tormenta", "Árvore caída ou estragos da tempestade"],
  "Stay clear of the damage and of any wires. Call the park's emergency line. If a wire is down or anyone is hurt, call 911 first.": ["Manténgase lejos de los daños y de cualquier cable. Llame a la línea de emergencia del parque. Si hay un cable caído o alguien herido, llame primero al 911.", "Fique longe dos estragos e de qualquer fio. Ligue para a linha de emergência do parque. Se houver fio caído ou alguém ferido, ligue primeiro para o 911."],
  "Locked out": ["Se quedó afuera sin llave", "Ficou trancado do lado de fora"],
  "Call the park's emergency line. Staff may not be able to open your RV or home, but can help you find a locksmith.": ["Llame a la línea de emergencia del parque. Es posible que el personal no pueda abrir su RV o vivienda, pero puede ayudarle a encontrar un cerrajero.", "Ligue para a linha de emergência do parque. A equipe talvez não consiga abrir seu RV ou casa, mas pode ajudar a encontrar um chaveiro."],
  "Hurricane or tropical storm coming": ["Se acerca un huracán o tormenta tropical", "Furacão ou tempestade tropical se aproximando"],
  "Follow official alerts from local emergency management and the National Weather Service. Secure or bring in awnings, chairs, grills and anything that can blow away. Know your evacuation route and leave when an evacuation order is issued. Call the park's emergency line for park-related questions.": ["Siga las alertas oficiales de manejo de emergencias local y del Servicio Nacional de Meteorología. Asegure o guarde toldos, sillas, parrillas y todo lo que el viento pueda llevarse. Conozca su ruta de evacuación y salga cuando se emita una orden de evacuación. Para preguntas sobre el parque, llame a la línea de emergencia del parque.", "Acompanhe os alertas oficiais da defesa civil local e do Serviço Nacional de Meteorologia (NWS). Prenda ou guarde toldos, cadeiras, churrasqueiras e tudo o que o vento possa levar. Conheça sua rota de evacuação e saia quando houver ordem de evacuação. Para dúvidas sobre o parque, ligue para a linha de emergência do parque."],

  // ---- LeaseAddendaCard ----
  "Could not open the signed copy.": ["No se pudo abrir la copia firmada.", "Não foi possível abrir a cópia assinada."],
  "Could not sign. Please try again.": ["No se pudo firmar. Inténtelo de nuevo.", "Não foi possível assinar. Tente novamente."],
  "Signed. Thank you!": ["Firmado. ¡Gracias!", "Assinado. Obrigado!"],
  "Download signed copy": ["Descargar copia firmada", "Baixar cópia assinada"],
  "Action needed": ["Acción requerida", "Ação necessária"],
  "Please review and sign: {title}": ["Revise y firme, por favor: {title}", "Revise e assine, por favor: {title}"],
  "{park} sent you a short agreement that puts in writing the park's rule for returned payments{lot}. Everything else about your rental stays the same. Sent {date}.": ["{park} le envió un acuerdo corto que deja por escrito la regla del parque sobre pagos devueltos{lot}. Todo lo demás de su alquiler sigue igual. Enviado el {date}.", "{park} enviou um acordo curto que coloca por escrito a regra do parque sobre pagamentos devolvidos{lot}. Todo o resto do seu aluguel continua igual. Enviado em {date}."],
  " for Lot {name}": [" para el lote {name}", " para o lote {name}"],
  "Review and sign": ["Revisar y firmar", "Revisar e assinar"],
  "<b>I have read and agree</b> to this Resident Agreement, and I adopt the signature below and agree to sign electronically.": ["<b>He leído y acepto</b> este Acuerdo de Residente, adopto la firma de abajo y acepto firmar electrónicamente.", "<b>Li e aceito</b> este Acordo de Morador, adoto a assinatura abaixo e concordo em assinar eletronicamente."],
  "Type your full name to sign": ["Escriba su nombre completo para firmar", "Digite seu nome completo para assinar"],
  "Your signature": ["Su firma", "Sua assinatura"],
  "By checking the box and pressing <b>Sign agreement</b>, I agree that the signature shown above, together with my typed name, is my electronic signature on this agreement, the same as a pen-and-paper signature. I consent to receive this agreement and related notices electronically, and I understand I can download a signed copy from Documents. My name, the date and time, my IP address and device are recorded with my signature.": ["Al marcar la casilla y presionar <b>Firmar acuerdo</b>, acepto que la firma que aparece arriba, junto con mi nombre escrito, es mi firma electrónica en este acuerdo, igual que una firma en papel. Acepto recibir este acuerdo y los avisos relacionados de forma electrónica, y entiendo que puedo descargar una copia firmada en Documentos. Con mi firma se registran mi nombre, la fecha y la hora, mi dirección IP y mi dispositivo.", "Ao marcar a caixa e tocar em <b>Assinar acordo</b>, concordo que a assinatura mostrada acima, junto com meu nome digitado, é a minha assinatura eletrônica neste acordo, igual a uma assinatura no papel. Aceito receber este acordo e os avisos relacionados de forma eletrônica, e entendo que posso baixar uma cópia assinada em Documentos. Meu nome, a data e a hora, meu endereço IP e meu dispositivo são registrados com a minha assinatura."],
  "Not now": ["Ahora no", "Agora não"],
  "Signing…": ["Firmando…", "Assinando…"],
  "Sign agreement": ["Firmar acuerdo", "Assinar acordo"],

  // ---- ViewAsBanner / view-as ready ----
  "Viewing as {name} — read only. Nothing can be paid, signed or changed.": ["Viendo como {name} — solo lectura. No se puede pagar, firmar ni cambiar nada.", "Visualizando como {name} — somente leitura. Nada pode ser pago, assinado ou alterado."],
  "Viewing as {name} — read only": ["Viendo como {name} — solo lectura", "Visualizando como {name} — somente leitura"],
  "Nothing can be paid, signed or changed.": ["No se puede pagar, firmar ni cambiar nada.", "Nada pode ser pago, assinado ou alterado."],
  "Exiting…": ["Saliendo…", "Saindo…"],
  "Exit": ["Salir", "Sair"],
  "This link is invalid, expired or was already used. Open it again from the admin.": ["Este enlace no es válido, venció o ya se usó. Ábralo de nuevo desde la administración.", "Este link é inválido, expirou ou já foi usado. Abra de novo pela administração."],
  "This link only works on the park's own website.": ["Este enlace solo funciona en el sitio web del parque.", "Este link só funciona no site do próprio parque."],
  "You are no longer allowed to view this resident's portal.": ["Ya no tiene permiso para ver el portal de este residente.", "Você não tem mais permissão para ver o portal deste morador."],
  "This view has ended. Open it again from the admin.": ["Esta vista terminó. Ábrala de nuevo desde la administración.", "Esta visualização terminou. Abra de novo pela administração."],
  "Could not open the resident portal. Please try again.": ["No se pudo abrir el portal de residentes. Inténtelo de nuevo.", "Não foi possível abrir o portal do morador. Tente novamente."],
  "View as resident": ["Ver como residente", "Ver como morador"],
  "Park staff only": ["Solo para el personal del parque", "Somente para a equipe do parque"],
  "You are opening {name}'s portal as park staff, read only. Nothing can be paid, signed or changed.": ["Está abriendo el portal de {name} como personal del parque, en modo de solo lectura. No se puede pagar, firmar ni cambiar nada.", "Você está abrindo o portal de {name} como equipe do parque, somente leitura. Nada pode ser pago, assinado ou alterado."],
  "this resident": ["este residente", "este morador"],
  "I'm not park staff": ["No soy personal del parque", "Não sou da equipe do parque"],
  "Open read-only view": ["Abrir en solo lectura", "Abrir somente leitura"],
  "Opening the resident portal (read only)…": ["Abriendo el portal de residentes (solo lectura)…", "Abrindo o portal do morador (somente leitura)…"],

  // ---- SmsAlertsToggle ----
  "Could not save.": ["No se pudo guardar.", "Não foi possível salvar."],
  "Text message alerts are on.": ["Las alertas por mensaje de texto están activadas.", "Os alertas por SMS estão ativados."],
  "Text message alerts are off.": ["Las alertas por mensaje de texto están desactivadas.", "Os alertas por SMS estão desativados."],
  "Text message alerts:": ["Alertas por mensaje de texto:", "Alertas por SMS:"],
  "On": ["Activadas", "Ativados"],
  "Off": ["Desactivadas", "Desativados"],
  "Turn off": ["Desactivar", "Desativar"],
  "Add your mobile number above to get text alerts.": ["Agregue su número de celular arriba para recibir alertas por texto.", "Adicione seu número de celular acima para receber alertas por SMS."],
  "Turn on text alerts": ["Activar alertas por texto", "Ativar alertas por SMS"],

  // ---- InstallApp ----
  "Get the {name} app": ["Obtenga la app de {name}", "Baixe o app de {name}"],
  "Open your account in one tap from your home screen, with alerts on the icon.": ["Abra su cuenta con un toque desde la pantalla de inicio, con avisos en el ícono.", "Abra sua conta com um toque na tela inicial, com avisos no ícone."],
  "In Safari, tap <b>Share</b> {icon} then <b>Add to Home Screen</b>.": ["En Safari, toque <b>Compartir</b> {icon} y luego <b>Agregar a pantalla de inicio</b>.", "No Safari, toque em <b>Compartilhar</b> {icon} e depois em <b>Adicionar à Tela de Início</b>."],
  "Install": ["Instalar", "Instalar"],
  "Share icon": ["Ícono de compartir", "Ícone de compartilhar"],

  // ---- ResidentPushAlerts ----
  "Alerts are not ready yet.": ["Las alertas aún no están listas.", "Os alertas ainda não estão prontos."],
  "Alerts are on for this device.": ["Las alertas están activadas en este dispositivo.", "Os alertas estão ativados neste dispositivo."],
  "Could not turn on alerts.": ["No se pudieron activar las alertas.", "Não foi possível ativar os alertas."],
  "📲 To get alerts on iPhone/iPad: tap Share → \"Add to Home Screen\", then open the app from your Home Screen.": ["📲 Para recibir alertas en iPhone/iPad: toque Compartir → \"Agregar a pantalla de inicio\" y luego abra la app desde su pantalla de inicio.", "📲 Para receber alertas no iPhone/iPad: toque em Compartilhar → \"Adicionar à Tela de Início\" e depois abra o app pela Tela de Início."],
  "🔕 Alerts are blocked for this app. Turn them on in your device or browser settings.": ["🔕 Las alertas están bloqueadas para esta app. Actívelas en la configuración de su dispositivo o navegador.", "🔕 Os alertas estão bloqueados para este app. Ative nas configurações do seu dispositivo ou navegador."],
  "🔔 Alerts on — turn off on this device": ["🔔 Alertas activadas — desactivar en este dispositivo", "🔔 Alertas ativados — desativar neste dispositivo"],
  "Turning on…": ["Activando…", "Ativando…"],
  "🔔 Turn on alerts on this device": ["🔔 Activar alertas en este dispositivo", "🔔 Ativar alertas neste dispositivo"],

  // ---- GolfCartCard ----
  "Insurance expired — please upload your renewal": ["Seguro vencido — suba su renovación, por favor", "Seguro vencido — envie a renovação, por favor"],
  "Insurance expires in {n} day(s)": ["El seguro vence en {n} día(s)", "O seguro vence em {n} dia(s)"],
  "Please upload a photo or a PDF.": ["Suba una foto o un PDF.", "Envie uma foto ou um PDF."],
  "Could not upload the insurance copy: {detail}": ["No se pudo subir la copia del seguro: {detail}", "Não foi possível enviar a cópia do seguro: {detail}"],
  "Could not save: {detail}": ["No se pudo guardar: {detail}", "Não foi possível salvar: {detail}"],
  "🛺 Golf Cart": ["🛺 Carrito de golf", "🛺 Carrinho de golfe"],
  "No golf cart on file.": ["No hay carrito de golf registrado.", "Nenhum carrinho de golfe cadastrado."],
  "Serial/Tag: {value}": ["Serie/placa: {value}", "Série/placa: {value}"],
  "Insurance: {company} · Policy {policy} · Expires {date}": ["Seguro: {company} · Póliza {policy} · Vence {date}", "Seguro: {company} · Apólice {policy} · Vence {date}"],
  "Insurance copy on file": ["Copia del seguro registrada", "Cópia do seguro cadastrada"],
  "Insurance copy not uploaded": ["No ha subido la copia del seguro", "Cópia do seguro não enviada"],
  "Golf carts must be insured and driven only by a person with a valid driver's license.": ["Los carritos de golf deben estar asegurados y solo puede manejarlos una persona con licencia de conducir vigente.", "Os carrinhos de golfe precisam ter seguro e só podem ser dirigidos por quem tem carteira de motorista válida."],
  "Edit Golf Cart": ["Editar carrito de golf", "Editar carrinho de golfe"],
  " Up to {n} golf cart(s).": [" Hasta {n} carrito(s) de golf.", " Até {n} carrinho(s) de golfe."],
  "Golf Cart {n}": ["Carrito de golf {n}", "Carrinho de golfe {n}"],
  "e.g. Club Car": ["p. ej. Club Car", "ex.: Club Car"],
  "Serial # or tag # (optional)": ["Número de serie o de placa (opcional)", "Número de série ou da placa (opcional)"],
  "Insurance company": ["Compañía de seguros", "Seguradora"],
  "Policy #": ["Póliza n.º", "Apólice nº"],
  "Insurance expiration date": ["Fecha de vencimiento del seguro", "Data de vencimento do seguro"],
  "Copy of insurance (photo or PDF)": ["Copia del seguro (foto o PDF)", "Cópia do seguro (foto ou PDF)"],
  " — optional": [" — opcional", " — opcional"],
  "✓ On file": ["✓ Registrada", "✓ Cadastrada"],
  "Replace": ["Reemplazar", "Substituir"],
  "+ Add a golf cart": ["+ Agregar un carrito de golf", "+ Adicionar um carrinho de golfe"],

  // ---- Electric usage history ----
  "Could not load electric history.": ["No se pudo cargar el historial eléctrico.", "Não foi possível carregar o histórico de energia."],
  "Search and view your monthly electric readings.": ["Busque y vea sus lecturas eléctricas mensuales.", "Busque e veja suas leituras mensais de energia."],
  "Search by month or year, example: June 2026": ["Buscar por mes o año, por ejemplo: junio 2026", "Buscar por mês ou ano, por exemplo: junho 2026"],
  "Showing readings for {year}. Search above to find a different month or year.": ["Mostrando las lecturas de {year}. Use el buscador para encontrar otro mes o año.", "Mostrando as leituras de {year}. Use a busca acima para encontrar outro mês ou ano."],
  "📊 Monthly Electric Usage": ["📊 Consumo eléctrico mensual", "📊 Consumo mensal de energia"],
  "No electric history found.": ["No hay historial eléctrico.", "Nenhum histórico de energia."],
  "No readings match your search.": ["Ninguna lectura coincide con su búsqueda.", "Nenhuma leitura corresponde à sua busca."],
  "No electric readings for {year} yet.": ["Todavía no hay lecturas eléctricas de {year}.", "Ainda não há leituras de energia de {year}."],
  "View details": ["Ver detalles", "Ver detalhes"],
  "Meter reading": ["Lectura del medidor", "Leitura do medidor"],
  "Used": ["Consumido", "Consumido"],
  "Included": ["Incluido", "Incluído"],
  "Billable": ["Facturable", "Cobrado"],
  "Rate": ["Tarifa", "Tarifa"],
  "{amount} per kWh": ["{amount} por kWh", "{amount} por kWh"],
  "Meter #": ["Medidor n.º", "Medidor nº"],
  "{exact}, rounded to {charge}": ["{exact}, redondeado a {charge}", "{exact}, arredondado para {charge}"],
  "{used} kWh used − {included} kWh included = {billable} kWh × {rate} = {total}": ["{used} kWh consumidos − {included} kWh incluidos = {billable} kWh × {rate} = {total}", "{used} kWh consumidos − {included} kWh incluídos = {billable} kWh × {rate} = {total}"],

  // ---- Login / reset password ----
  "Resident Login": ["Acceso de residentes", "Acesso do morador"],
  "Access your account to view invoices and make payments.": ["Entre a su cuenta para ver sus facturas y hacer pagos.", "Acesse sua conta para ver faturas e fazer pagamentos."],
  "Sign In": ["Iniciar sesión", "Entrar"],
  "Pay Invoice Now": ["Pagar factura ahora", "Pagar fatura agora"],
  "Password": ["Contraseña", "Senha"],
  "Forgot password?": ["¿Olvidó su contraseña?", "Esqueceu a senha?"],
  "Signing in...": ["Entrando...", "Entrando..."],
  "Sign In →": ["Iniciar sesión →", "Entrar →"],
  "Don't have an account? Contact the office at": ["¿No tiene cuenta? Comuníquese con la oficina al", "Não tem conta? Fale com o escritório pelo"],
  "Reset Password": ["Restablecer contraseña", "Redefinir senha"],
  "Enter your email and we'll send you a secure link to set a new password.": ["Escriba su correo y le enviaremos un enlace seguro para crear una contraseña nueva.", "Digite seu e-mail e enviaremos um link seguro para criar uma nova senha."],
  "Send Reset Link": ["Enviar enlace", "Enviar link"],
  "← Back to Sign In": ["← Volver a iniciar sesión", "← Voltar para entrar"],
  "If an account exists for that email, a reset link has been sent.": ["Si existe una cuenta con ese correo, le enviamos un enlace para restablecer la contraseña.", "Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha."],
  "Invalid email or password. Please try again.": ["Correo o contraseña incorrectos. Inténtelo de nuevo.", "E-mail ou senha incorretos. Tente novamente."],
  "This reset link is invalid. Please request a new one.": ["Este enlace no es válido. Pida uno nuevo.", "Este link é inválido. Peça um novo."],
  "Passwords do not match.": ["Las contraseñas no coinciden.", "As senhas não coincidem."],
  "Unable to reset password.": ["No se pudo restablecer la contraseña.", "Não foi possível redefinir a senha."],
  "Password updated. You can now sign in with your new password.": ["Contraseña actualizada. Ya puede iniciar sesión con su nueva contraseña.", "Senha atualizada. Agora você pode entrar com a nova senha."],
  "New Password": ["Contraseña nueva", "Nova senha"],
  "Confirm Password": ["Confirmar contraseña", "Confirmar senha"],
  "Updating...": ["Actualizando...", "Atualizando..."],
  "Update Password": ["Actualizar contraseña", "Atualizar senha"],
  "At least 9 characters, with 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.": ["Al menos 9 caracteres, con 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial.", "Pelo menos 9 caracteres, com 1 letra maiúscula, 1 minúscula, 1 número e 1 caractere especial."],
  "you@example.com": ["usted@ejemplo.com", "voce@exemplo.com"],

  // ---- Invoices page ----
  "Could not load invoices: {detail}": ["No se pudieron cargar las facturas: {detail}", "Não foi possível carregar as faturas: {detail}"],
  "Could not load invoices (unexpected error): {detail}": ["No se pudieron cargar las facturas (error inesperado): {detail}", "Não foi possível carregar as faturas (erro inesperado): {detail}"],
  "Could not download invoice: {detail}": ["No se pudo descargar la factura: {detail}", "Não foi possível baixar a fatura: {detail}"],
  "Could not download invoice (unexpected error): {detail}": ["No se pudo descargar la factura (error inesperado): {detail}", "Não foi possível baixar a fatura (erro inesperado): {detail}"],
  "No due date": ["Sin fecha de vencimiento", "Sem vencimento"],
  "Loading invoices...": ["Cargando facturas...", "Carregando faturas..."],
  "Invoices": ["Facturas", "Faturas"],
  "View your monthly invoices and charge breakdown, or download a printable PDF.": ["Vea sus facturas mensuales y el detalle de cargos, o descargue un PDF para imprimir.", "Veja suas faturas mensais e o detalhamento das cobranças, ou baixe um PDF para imprimir."],
  "Search by month or year": ["Buscar por mes o año", "Buscar por mês ou ano"],
  "e.g. August, or 2026": ["p. ej. agosto, o 2026", "ex.: agosto, ou 2026"],
  "Showing invoices for {year}. Search above to find invoices from a different month or year.": ["Mostrando las facturas de {year}. Use el buscador para encontrar facturas de otro mes o año.", "Mostrando as faturas de {year}. Use a busca acima para encontrar faturas de outro mês ou ano."],
  "No invoices found yet.": ["Todavía no hay facturas.", "Ainda não há faturas."],
  "No invoices match your search.": ["Ninguna factura coincide con su búsqueda.", "Nenhuma fatura corresponde à sua busca."],
  "No invoices for {year} yet.": ["Todavía no hay facturas de {year}.", "Ainda não há faturas de {year}."],
  "Invoice": ["Factura", "Fatura"],
  "Due: {date}": ["Vence: {date}", "Vencimento: {date}"],
  "Upcoming — available to pay on {date}": ["Próxima — disponible para pagar el {date}", "Próxima — disponível para pagamento em {date}"],
  "Preparing...": ["Preparando...", "Preparando..."],
  "⬇ Download PDF": ["⬇ Descargar PDF", "⬇ Baixar PDF"],
  "Invoice PDFs are in English.": ["Los PDF de las facturas están en inglés.", "Os PDFs das faturas estão em inglês."],

  // ---- Payment history ----
  "Could not load payment history: {detail}": ["No se pudo cargar el historial de pagos: {detail}", "Não foi possível carregar o histórico de pagamentos: {detail}"],
  "Could not load payment history (unexpected error): {detail}": ["No se pudo cargar el historial de pagos (error inesperado): {detail}", "Não foi possível carregar o histórico de pagamentos (erro inesperado): {detail}"],
  "No payment date": ["Sin fecha de pago", "Sem data de pagamento"],
  "Last {n} days": ["Últimos {n} días", "Últimos {n} dias"],
  "Loading payment history...": ["Cargando historial de pagos...", "Carregando histórico de pagamentos..."],
  "Payment History": ["Historial de pagos", "Histórico de pagamentos"],
  "View a statement of your completed payments.": ["Vea un estado de cuenta de sus pagos realizados.", "Veja um extrato dos seus pagamentos concluídos."],
  "Show transactions from:": ["Mostrar movimientos de:", "Mostrar transações de:"],
  "Specific Month": ["Un mes específico", "Um mês específico"],
  "Specific Year": ["Un año específico", "Um ano específico"],
  "Total for this period": ["Total de este período", "Total deste período"],
  "🖨️ Print": ["🖨️ Imprimir", "🖨️ Imprimir"],
  "No payments found for this period.": ["No hay pagos en este período.", "Nenhum pagamento neste período."],
  "DATE": ["FECHA", "DATA"],
  "DESCRIPTION": ["DESCRIPCIÓN", "DESCRIÇÃO"],
  "METHOD": ["FORMA", "FORMA"],
  "AMOUNT": ["MONTO", "VALOR"],
  "Bank (ACH)": ["Banco (ACH)", "Banco (ACH)"],
  "Cash": ["Efectivo", "Dinheiro"],
  "Check": ["Cheque", "Cheque"],
  "Money Order": ["Giro postal", "Ordem de pagamento"],
  "Autopay (card)": ["Pago automático (tarjeta)", "Pagamento automático (cartão)"],
  "Autopay (bank)": ["Pago automático (banco)", "Pagamento automático (banco)"],
  "Rent": ["Alquiler", "Aluguel"],
  "Monthly Rent": ["Alquiler mensual", "Aluguel mensal"],
  "Electric": ["Electricidad", "Energia"],
  "Electric Service": ["Servicio eléctrico", "Serviço de energia"],
  "Late Fee": ["Recargo por pago tardío", "Multa por atraso"],
  "Security Deposit": ["Depósito de seguridad", "Depósito caução"],
  "Monthly Invoice": ["Factura mensual", "Fatura mensal"],
  "Processing Fee": ["Cargo por procesamiento", "Taxa de processamento"],
  "Water": ["Agua", "Água"],
  "Trash": ["Basura", "Lixo"],
  "Wifi": ["Wifi", "Wi-Fi"],
  "Propane (charge)": ["Propano", "Propano"],

  // ---- Documents ----
  "General": ["General", "Geral"],
  "Lease Agreement": ["Contrato de arrendamiento", "Contrato de locação"],
  "ID": ["Identificación", "Documento de identidade"],
  "Insurance": ["Seguro", "Seguro"],
  "Registration": ["Registro del vehículo", "Registro do veículo"],
  "Move-Out / Cancellation Statement": ["Estado de cuenta de mudanza / cancelación", "Extrato de mudança / cancelamento"],
  "Bill of Sale": ["Contrato de compraventa", "Contrato de compra e venda"],
  "Resident Agreement (signed online)": ["Acuerdo de residente (firmado en línea)", "Acordo de morador (assinado on-line)"],
  "Could not load your documents: {detail}": ["No se pudieron cargar sus documentos: {detail}", "Não foi possível carregar seus documentos: {detail}"],
  "Could not load your documents (unexpected error): {detail}": ["No se pudieron cargar sus documentos (error inesperado): {detail}", "Não foi possível carregar seus documentos (erro inesperado): {detail}"],
  "Please choose a file first.": ["Primero elija un archivo.", "Escolha um arquivo primeiro."],
  "Could not read file.": ["No se pudo leer el archivo.", "Não foi possível ler o arquivo."],
  "Could not save document: {detail}": ["No se pudo guardar el documento: {detail}", "Não foi possível salvar o documento: {detail}"],
  "✅ Document uploaded.": ["✅ Documento subido.", "✅ Documento enviado."],
  "Could not upload document (unexpected error): {detail}": ["No se pudo subir el documento (error inesperado): {detail}", "Não foi possível enviar o documento (erro inesperado): {detail}"],
  "Could not open this document.": ["No se pudo abrir este documento.", "Não foi possível abrir este documento."],
  "Could not open this document: {detail}": ["No se pudo abrir este documento: {detail}", "Não foi possível abrir este documento: {detail}"],
  "Remove this document?": ["¿Quitar este documento?", "Remover este documento?"],
  "Could not remove document: {detail}": ["No se pudo quitar el documento: {detail}", "Não foi possível remover o documento: {detail}"],
  "Could not remove document (unexpected error): {detail}": ["No se pudo quitar el documento (error inesperado): {detail}", "Não foi possível remover o documento (erro inesperado): {detail}"],
  "Loading your documents...": ["Cargando sus documentos...", "Carregando seus documentos..."],
  "My Documents": ["Mis documentos", "Meus documentos"],
  "View and download your signed lease agreement(s) and other documents on file.": ["Vea y descargue su(s) contrato(s) de arrendamiento firmado(s) y otros documentos registrados.", "Veja e baixe seu(s) contrato(s) de locação assinado(s) e outros documentos cadastrados."],
  "LEASE AGREEMENT(S)": ["CONTRATO(S) DE ARRENDAMIENTO", "CONTRATO(S) DE LOCAÇÃO"],
  "No lease documents on file yet.": ["Todavía no hay contratos registrados.", "Ainda não há contratos cadastrados."],
  "{rent}/mo · Deposit: {deposit}": ["{rent}/mes · Depósito: {deposit}", "{rent}/mês · Depósito: {deposit}"],
  "📄 View / Print PDF": ["📄 Ver / imprimir PDF", "📄 Ver / imprimir PDF"],
  "PDF not available": ["PDF no disponible", "PDF indisponível"],
  "OTHER DOCUMENTS": ["OTROS DOCUMENTOS", "OUTROS DOCUMENTOS"],
  "Upload a document (ID, insurance, registration, etc.)": ["Subir un documento (identificación, seguro, registro, etc.)", "Enviar um documento (identidade, seguro, registro etc.)"],
  "Choose the type below, then choose a file — it uploads automatically, no extra button to click.": ["Elija el tipo abajo y luego el archivo — se sube automáticamente, sin otro botón.", "Escolha o tipo abaixo e depois o arquivo — ele é enviado automaticamente, sem outro botão."],
  "This is for: Myself": ["Es para: mí", "É para: mim"],
  "This is for: {name}": ["Es para: {name}", "É para: {name}"],
  "No documents uploaded yet.": ["Todavía no ha subido documentos.", "Nenhum documento enviado ainda."],
  "📄 View": ["📄 Ver", "📄 Ver"],
  "You still need to pay for and start 1 background check.": ["Todavía le falta pagar e iniciar 1 verificación de antecedentes.", "Você ainda precisa pagar e iniciar 1 verificação de antecedentes."],
  "You still need to pay for and start {n} background checks.": ["Todavía le falta pagar e iniciar {n} verificaciones de antecedentes.", "Você ainda precisa pagar e iniciar {n} verificações de antecedentes."],
  "Uploading an ID here doesn't start the check by itself — head to Background Checks to finish it.": ["Subir una identificación aquí no inicia la verificación por sí solo — vaya a Verificaciones de antecedentes para terminarla.", "Enviar um documento aqui não inicia a verificação sozinho — vá até Verificações de antecedentes para concluir."],

  // ---- Maintenance page ----
  "Are you sure you want to cancel this maintenance request?": ["¿Seguro que desea cancelar esta solicitud de mantenimiento?", "Tem certeza de que quer cancelar esta solicitação de manutenção?"],
  "Could not cancel request.": ["No se pudo cancelar la solicitud.", "Não foi possível cancelar a solicitação."],
  "Maintenance request cancelled.": ["Solicitud de mantenimiento cancelada.", "Solicitação de manutenção cancelada."],
  "Please enter a subject.": ["Escriba un asunto.", "Digite um assunto."],
  "Could not create request.": ["No se pudo crear la solicitud.", "Não foi possível criar a solicitação."],
  "Your request was sent, but the photo could not be uploaded.": ["Su solicitud se envió, pero no se pudo subir la foto.", "Sua solicitação foi enviada, mas não foi possível enviar a foto."],
  "Maintenance request submitted.": ["Solicitud de mantenimiento enviada.", "Solicitação de manutenção enviada."],
  "+ New Request": ["+ Nueva solicitud", "+ Nova solicitação"],
  "New Maintenance Request": ["Nueva solicitud de mantenimiento", "Nova solicitação de manutenção"],
  "Subject": ["Asunto", "Assunto"],
  "Describe the issue...": ["Describa el problema...", "Descreva o problema..."],
  "Priority": ["Prioridad", "Prioridade"],
  "Attach photo": ["Adjuntar foto", "Anexar foto"],
  "Take photo": ["Tomar foto", "Tirar foto"],
  "Submit Request": ["Enviar solicitud", "Enviar solicitação"],
  "No maintenance requests found.": ["No hay solicitudes de mantenimiento.", "Nenhuma solicitação de manutenção."],
  "Submitted:": ["Enviada:", "Enviada:"],
  "No description provided.": ["Sin descripción.", "Sem descrição."],
  "Status:": ["Estado:", "Status:"],
  "Priority:": ["Prioridad:", "Prioridade:"],
  "Maintenance Photo": ["Foto de mantenimiento", "Foto da manutenção"],
  "Updates from the office:": ["Novedades de la oficina:", "Atualizações do escritório:"],

  // ---- Marketplace ----
  "Womenswear": ["Ropa de mujer", "Roupa feminina"],
  "Menswear": ["Ropa de hombre", "Roupa masculina"],
  "Kidswear & Baby": ["Ropa de niños y bebés", "Roupa infantil e bebê"],
  "Antiques": ["Antigüedades", "Antiguidades"],
  "Books": ["Libros", "Livros"],
  "Movies & Music": ["Películas y música", "Filmes e música"],
  "Classifieds": ["Clasificados", "Classificados"],
  "Electronics": ["Electrónica", "Eletrônicos"],
  "Entertainment": ["Entretenimiento", "Entretenimento"],
  "Free Stuff": ["Cosas gratis", "Coisas grátis"],
  "Garage Sale": ["Venta de garaje", "Bazar de garagem"],
  "Patio & Garden": ["Patio y jardín", "Pátio e jardim"],
  "Health & Beauty": ["Salud y belleza", "Saúde e beleza"],
  "Hobbies": ["Pasatiempos", "Hobbies"],
  "Home & Kitchen": ["Hogar y cocina", "Casa e cozinha"],
  "Home Improvement": ["Mejoras para el hogar", "Reforma e construção"],
  "Home Sales": ["Venta de viviendas", "Venda de imóveis"],
  "Jewelry & Watches": ["Joyas y relojes", "Joias e relógios"],
  "Luggage & Bags": ["Maletas y bolsos", "Malas e bolsas"],
  "Musical Instruments": ["Instrumentos musicales", "Instrumentos musicais"],
  "Office Supplies": ["Artículos de oficina", "Material de escritório"],
  "Pet Supplies": ["Artículos para mascotas", "Artigos para animais"],
  "RV Parts": ["Piezas para RV", "Peças para RV"],
  "Sporting Goods": ["Artículos deportivos", "Artigos esportivos"],
  "Toys & Games": ["Juguetes y juegos", "Brinquedos e jogos"],
  "Miscellaneous": ["Varios", "Diversos"],
  "Please enter a title.": ["Escriba un título.", "Digite um título."],
  "Could not save listing: {detail}": ["No se pudo guardar el anuncio: {detail}", "Não foi possível salvar o anúncio: {detail}"],
  "Delete this listing?": ["¿Eliminar este anuncio?", "Excluir este anúncio?"],
  "← Back to Marketplace": ["← Volver al Marketplace", "← Voltar ao Marketplace"],
  "No photos": ["Sin fotos", "Sem fotos"],
  "✅ Copied": ["✅ Copiado", "✅ Copiado"],
  "🔗 Share": ["🔗 Compartir", "🔗 Compartilhar"],
  "Share": ["Compartir", "Compartilhar"],
  "Free / Make an offer": ["Gratis / Haga una oferta", "Grátis / Faça uma oferta"],
  "SOLD": ["VENDIDO", "VENDIDO"],
  "Category: {name}": ["Categoría: {name}", "Categoria: {name}"],
  "Expires in {n} day — repost to keep it active": ["Vence en {n} día — vuelva a publicarlo para mantenerlo activo", "Expira em {n} dia — republique para mantê-lo ativo"],
  "Expires in {n} days — repost to keep it active": ["Vence en {n} días — vuelva a publicarlo para mantenerlo activo", "Expira em {n} dias — republique para mantê-lo ativo"],
  "This listing has expired": ["Este anuncio venció", "Este anúncio expirou"],
  "Seller": ["Vendedor", "Vendedor"],
  "Posted by {park}": ["Publicado por {park}", "Publicado por {park}"],
  "the park": ["el parque", "o parque"],
  "Contact the office for details.": ["Comuníquese con la oficina para más detalles.", "Fale com o escritório para mais detalhes."],
  "Contact them in person at the park, or through the office.": ["Comuníquese en persona en el parque o a través de la oficina.", "Fale pessoalmente no parque ou pelo escritório."],
  "❤️ Saved": ["❤️ Guardado", "❤️ Salvo"],
  "🤍 Save": ["🤍 Guardar", "🤍 Salvar"],
  "Mark as Sold": ["Marcar como vendido", "Marcar como vendido"],
  "🔁 Repost": ["🔁 Volver a publicar", "🔁 Republicar"],
  "No photo": ["Sin foto", "Sem foto"],
  "Free / OBO": ["Gratis / Acepto ofertas", "Grátis / Aceito ofertas"],
  "Expires in {n}d": ["Vence en {n} d", "Expira em {n} d"],
  "+ Post a Listing": ["+ Publicar un anuncio", "+ Publicar um anúncio"],
  "Edit Listing": ["Editar anuncio", "Editar anúncio"],
  "New Listing": ["Nuevo anuncio", "Novo anúncio"],
  "Title (e.g. Patio Chairs, Bike Rack...)": ["Título (p. ej. sillas de patio, portabicicletas...)", "Título (ex.: cadeiras de pátio, suporte de bicicleta...)"],
  "Description": ["Descripción", "Descrição"],
  "Price ($, leave blank for free/OBO)": ["Precio ($; déjelo en blanco si es gratis o acepta ofertas)", "Preço ($; deixe em branco se for grátis ou aceitar ofertas)"],
  "Photos (up to 10)": ["Fotos (hasta 10)", "Fotos (até 10)"],
  "You can upload up to 10 photos. Only the first 10 will be used.": ["Puede subir hasta 10 fotos. Solo se usarán las primeras 10.", "Você pode enviar até 10 fotos. Só as 10 primeiras serão usadas."],
  "Preview {n}": ["Vista previa {n}", "Prévia {n}"],
  "Update Listing": ["Actualizar anuncio", "Atualizar anúncio"],
  "Post Listing": ["Publicar anuncio", "Publicar anúncio"],
  "Browse": ["Explorar", "Explorar"],
  "My Listings": ["Mis anuncios", "Meus anúncios"],
  "Saved": ["Guardados", "Salvos"],
  "Search listings...": ["Buscar anuncios...", "Buscar anúncios..."],
  "All Categories": ["Todas las categorías", "Todas as categorias"],
  "🆕 New For You": ["🆕 Nuevo para usted", "🆕 Novidades para você"],
  "You haven't posted anything yet.": ["Todavía no ha publicado nada.", "Você ainda não publicou nada."],
  "No listings yet.": ["Todavía no hay anuncios.", "Ainda não há anúncios."],

  // ---- Background checks page ----
  "Could not load background checks.": ["No se pudieron cargar las verificaciones de antecedentes.", "Não foi possível carregar as verificações de antecedentes."],
  "Could not load background checks (unexpected error): {detail}": ["No se pudieron cargar las verificaciones de antecedentes (error inesperado): {detail}", "Não foi possível carregar as verificações de antecedentes (erro inesperado): {detail}"],
  "Could not start payment (unexpected error): {detail}": ["No se pudo iniciar el pago (error inesperado): {detail}", "Não foi possível iniciar o pagamento (erro inesperado): {detail}"],
  "Household Background Checks": ["Verificaciones de antecedentes del hogar", "Verificações de antecedentes dos moradores"],
  "Anyone 18 or older living here permanently requires a background check.": ["Toda persona de 18 años o más que viva aquí de forma permanente necesita verificación de antecedentes.", "Toda pessoa com 18 anos ou mais que more aqui de forma permanente precisa de verificação de antecedentes."],
  "Payment received — check your email for a message with instructions to complete the background check. This can take a few minutes to arrive.": ["Pago recibido — revise su correo: le llegará un mensaje con instrucciones para completar la verificación de antecedentes. Puede tardar unos minutos.", "Pagamento recebido — verifique seu e-mail: chegará uma mensagem com instruções para concluir a verificação de antecedentes. Pode levar alguns minutos."],
  "Need to add another household occupant before paying?": ["¿Necesita agregar otro ocupante del hogar antes de pagar?", "Precisa adicionar outro morador antes de pagar?"],
  "+ Add Household Occupant": ["+ Agregar ocupante del hogar", "+ Adicionar morador"],
  "No background checks are pending right now.": ["No hay verificaciones de antecedentes pendientes por ahora.", "Não há verificações de antecedentes pendentes no momento."],
  "Select which occupant(s) to pay for now — you can pay for one, or all of them together in a single charge.": ["Elija por cuál(es) ocupante(s) pagar ahora — puede pagar por uno, o por todos juntos en un solo cobro.", "Escolha por qual(is) morador(es) pagar agora — você pode pagar por um, ou por todos juntos em uma única cobrança."],
  "Total ({n} selected)": ["Total ({n} seleccionados)", "Total ({n} selecionados)"],
  "Pay Now & Start Background Check(s)": ["Pagar ahora e iniciar verificación(es)", "Pagar agora e iniciar verificação(ões)"],

  // ---- Payment review ----
  "Could not verify payment.": ["No se pudo verificar el pago.", "Não foi possível verificar o pagamento."],
  "No charges selected.": ["No hay cargos seleccionados.", "Nenhuma cobrança selecionada."],
  "Could not load selected charges.": ["No se pudieron cargar los cargos seleccionados.", "Não foi possível carregar as cobranças selecionadas."],
  "Loading payment review...": ["Cargando la revisión del pago...", "Carregando a revisão do pagamento..."],
  "Payment Verification Failed": ["No se pudo verificar el pago", "Falha na verificação do pagamento"],
  "Payment Received": ["Pago recibido", "Pagamento recebido"],
  "Bank Payment Received": ["Pago bancario recibido", "Pagamento bancário recebido"],
  "Payment Status": ["Estado del pago", "Status do pagamento"],
  "Thank you. Sign in to your resident portal to see the receipt and your balance.": ["Gracias. Entre a su portal de residentes para ver el recibo y su saldo.", "Obrigado. Entre no portal do morador para ver o recibo e seu saldo."],
  "This payment hasn't been completed. Sign in to your resident portal to check your balance.": ["Este pago no se completó. Entre a su portal de residentes para revisar su saldo.", "Este pagamento não foi concluído. Entre no portal do morador para conferir seu saldo."],
  "Sign in": ["Iniciar sesión", "Entrar"],
  "Payment Successful": ["Pago exitoso", "Pagamento concluído"],
  "Your bank payment is processing and clears in 3–5 business days. Your invoices show \"Processing (bank)\" until then — there is nothing more to pay. You'll get a receipt by email once it clears.": ["Su pago bancario está en proceso y se acredita en 3 a 5 días hábiles. Hasta entonces sus facturas dicen \"En proceso (banco)\" — no tiene que pagar nada más. Recibirá un recibo por correo cuando se acredite.", "Seu pagamento bancário está em processamento e compensa em 3 a 5 dias úteis. Até lá, suas faturas mostram \"Em processamento (banco)\" — não há mais nada a pagar. Você receberá um recibo por e-mail quando compensar."],
  "Your payment has been processed successfully.": ["Su pago se procesó correctamente.", "Seu pagamento foi processado com sucesso."],
  "Amount (processing)": ["Monto (en proceso)", "Valor (em processamento)"],
  "Amount Paid": ["Monto pagado", "Valor pago"],
  "Charges Paid": ["Cargos pagados", "Cobranças pagas"],
  "Receipt #": ["Recibo n.º", "Recibo nº"],
  "Transaction ID": ["ID de transacción", "ID da transação"],
  "Payment Date": ["Fecha de pago", "Data do pagamento"],
  "Remaining Balance": ["Saldo restante", "Saldo restante"],
  "Payment Review": ["Revisión del pago", "Revisão do pagamento"],
  "Review your selected charges before payment.": ["Revise los cargos seleccionados antes de pagar.", "Revise as cobranças selecionadas antes de pagar."],
  "Selected Charges": ["Cargos seleccionados", "Cobranças selecionadas"],
  "No selected charges found.": ["No se encontraron cargos seleccionados.", "Nenhuma cobrança selecionada encontrada."],
  "Go to Dashboard to Pay": ["Ir al panel para pagar", "Ir ao painel para pagar"],

  // ---- Pay invoice (link without login) ----
  "Could not load this payment link.": ["No se pudo cargar este enlace de pago.", "Não foi possível carregar este link de pagamento."],
  "{park} — Pay Invoice": ["{park} — Pagar factura", "{park} — Pagar fatura"],
  "✅ Payment received — thank you!": ["✅ Pago recibido — ¡gracias!", "✅ Pagamento recebido — obrigado!"],
  "Payment was cancelled. You can try again below.": ["El pago se canceló. Puede intentarlo de nuevo abajo.", "O pagamento foi cancelado. Você pode tentar de novo abaixo."],
  "A bank payment for this invoice is processing (3–5 business days) — nothing to pay right now.": ["Hay un pago bancario de esta factura en proceso (3 a 5 días hábiles) — no hay nada que pagar ahora.", "Há um pagamento bancário desta fatura em processamento (3 a 5 dias úteis) — nada a pagar agora."],
  "Upcoming — the {month} invoice is available to pay on {date}.": ["Próxima — la factura de {month} estará disponible para pagar el {date}.", "Próxima — a fatura de {month} estará disponível para pagamento em {date}."],
  "Being prepared — the {month} invoice is available to pay on {date}.": ["En preparación — la factura de {month} estará disponible para pagar el {date}.", "Em preparação — a fatura de {month} estará disponível para pagamento em {date}."],
  "This is next month's invoice (due {date}). Paying it now is optional — you are paying ahead.": ["Esta es la factura del próximo mes (vence el {date}). Pagarla ahora es opcional — está pagando por adelantado.", "Esta é a fatura do próximo mês (vence em {date}). Pagar agora é opcional — você está pagando adiantado."],
  "You're paying an outstanding balance for a resident at {park}. For their privacy, this page only shows the amount due — not their name or full account.": ["Está pagando un saldo pendiente de un residente de {park}. Por su privacidad, esta página solo muestra el monto a pagar — no su nombre ni toda la cuenta.", "Você está pagando um saldo em aberto de um morador do {park}. Por privacidade, esta página mostra só o valor a pagar — não o nome nem a conta completa."],
  "Lot:": ["Lote:", "Lote:"],
  "Invoice:": ["Factura:", "Fatura:"],
  "Due Date:": ["Vence:", "Vencimento:"],
  "Pay {amount}": ["Pagar {amount}", "Pagar {amount}"],
  "✅ This invoice has already been paid — nothing due.": ["✅ Esta factura ya está pagada — no hay nada pendiente.", "✅ Esta fatura já foi paga — nada a pagar."],
  "Powered by MelyOS.io": ["Con la tecnología de MelyOS.io", "Desenvolvido por MelyOS.io"],

  // ---- Server messages (exact text from the API routes) ----
  "Invalid email or password. If you've tried several times, wait 15 minutes and try again.": ["Correo o contraseña incorrectos. Si lo intentó varias veces, espere 15 minutos y vuelva a intentarlo.", "E-mail ou senha incorretos. Se você tentou várias vezes, aguarde 15 minutos e tente de novo."],
  "Enter email and password.": ["Escriba su correo y contraseña.", "Digite seu e-mail e senha."],
  "Your portal access has ended. Please contact the park office if you believe this is a mistake.": ["Su acceso al portal terminó. Comuníquese con la oficina del parque si cree que es un error.", "Seu acesso ao portal terminou. Fale com o escritório do parque se achar que é um engano."],
  "Please pay your {month} invoice ({amount}) before accessing your resident portal.": ["Pague su factura de {month} ({amount}) antes de entrar a su portal de residentes.", "Pague sua fatura de {month} ({amount}) antes de acessar o portal do morador."],
  "Email is required": ["El correo es obligatorio", "O e-mail é obrigatório"],
  "Reset link is invalid or expired.": ["El enlace no es válido o venció.", "O link é inválido ou expirou."],
  "Token and password are required": ["Faltan el enlace o la contraseña", "Faltam o link ou a senha"],
  "Too many tries. Please wait a few minutes.": ["Demasiados intentos. Espere unos minutos.", "Tentativas demais. Aguarde alguns minutos."],
  "Not authenticated.": ["Su sesión terminó. Inicie sesión de nuevo.", "Sua sessão terminou. Entre novamente."],
  "Read only: you are viewing the portal as this resident. Nothing can be paid, signed or changed.": ["Solo lectura: está viendo el portal como este residente. No se puede pagar, firmar ni cambiar nada.", "Somente leitura: você está vendo o portal como este morador. Nada pode ser pago, assinado ou alterado."],
  "No pending balance found.": ["No hay saldo pendiente.", "Não há saldo em aberto."],
  "There is no invoice to pay ahead right now.": ["Ahora no hay ninguna factura para pagar por adelantado.", "Não há fatura para pagar adiantado agora."],
  "Bank payment is not available at this park. Please pay by card.": ["Este parque no acepta pagos bancarios. Pague con tarjeta, por favor.", "Este parque não aceita pagamento bancário. Pague com cartão, por favor."],
  "Bank payment is available on balances of {amount} or more. Please pay by card.": ["El pago bancario está disponible para saldos de {amount} o más. Pague con tarjeta, por favor.", "O pagamento bancário está disponível para saldos de {amount} ou mais. Pague com cartão, por favor."],
  "Your invoice is being prepared — it will be available to pay on {date}.": ["Su factura está en preparación — estará disponible para pagar el {date}.", "Sua fatura está em preparação — estará disponível para pagamento em {date}."],
  "Available to pay on {date}.": ["Disponible para pagar el {date}.", "Disponível para pagamento em {date}."],
  "Your electric reading is added around day {day} of the month — you can pay as soon as it's on your invoice.": ["Su lectura eléctrica se agrega alrededor del día {day} del mes — podrá pagar en cuanto aparezca en su factura.", "Sua leitura de energia é lançada por volta do dia {day} do mês — você poderá pagar assim que ela estiver na fatura."],
  "This invoice can be paid starting {date}.": ["Esta factura se puede pagar a partir del {date}.", "Esta fatura pode ser paga a partir de {date}."],
  "A bank payment for this invoice is already processing (3–5 business days). Nothing to pay right now.": ["Ya hay un pago bancario de esta factura en proceso (3 a 5 días hábiles). No hay nada que pagar ahora.", "Já há um pagamento bancário desta fatura em processamento (3 a 5 dias úteis). Nada a pagar agora."],
  "No balance due on this invoice.": ["Esta factura no tiene saldo pendiente.", "Esta fatura não tem saldo a pagar."],
  "This invoice has already been paid.": ["Esta factura ya está pagada.", "Esta fatura já foi paga."],
  "Payment link not found or expired.": ["El enlace de pago no existe o venció.", "O link de pagamento não existe ou expirou."],
  "Missing payment link token.": ["Falta el enlace de pago.", "Falta o link de pagamento."],
  "Missing token.": ["Falta el enlace.", "Falta o link."],
  "Could not create checkout session.": ["No se pudo abrir el pago.", "Não foi possível abrir o pagamento."],
  "Add a valid mobile number to your Resident Information first.": ["Primero agregue un número de celular válido en su información de residente.", "Primeiro adicione um número de celular válido nas suas informações de morador."],
  "That email is already used by another account. Please contact the office.": ["Ese correo ya lo usa otra cuenta. Comuníquese con la oficina.", "Esse e-mail já é usado por outra conta. Fale com o escritório."],
  "Please enter a valid email address.": ["Escriba un correo electrónico válido.", "Digite um e-mail válido."],
  "Could not save your information.": ["No se pudo guardar su información.", "Não foi possível salvar suas informações."],
  "Bank autopay isn't available yet. Please use a card for autopay, or pay by bank each month.": ["El pago automático bancario todavía no está disponible. Use una tarjeta para el pago automático, o pague con banco cada mes.", "O pagamento automático bancário ainda não está disponível. Use um cartão para o pagamento automático, ou pague com banco todo mês."],
  "Your bank is still verifying the account. Please try again later, or use a card.": ["Su banco todavía está verificando la cuenta. Inténtelo más tarde o use una tarjeta.", "Seu banco ainda está verificando a conta. Tente mais tarde ou use um cartão."],
  "This link is old. Please set up bank autopay again.": ["Este enlace es viejo. Configure de nuevo el pago automático bancario.", "Este link é antigo. Configure de novo o pagamento automático bancário."],
  "The bank account was not saved. Please try again.": ["La cuenta bancaria no se guardó. Inténtelo de nuevo.", "A conta bancária não foi salva. Tente novamente."],
  "This is not a card. Please use a card here, or set up autopay by bank.": ["Esto no es una tarjeta. Use una tarjeta aquí, o configure el pago automático con banco.", "Isto não é um cartão. Use um cartão aqui, ou configure o pagamento automático com banco."],
  "This card isn't saved on your account. Please add it again.": ["Esta tarjeta no está guardada en su cuenta. Agréguela de nuevo.", "Este cartão não está salvo na sua conta. Adicione de novo."],
  "Card not found. Please try again.": ["No se encontró la tarjeta. Inténtelo de nuevo.", "Cartão não encontrado. Tente novamente."],
  "Please accept the recurring charge authorization.": ["Acepte la autorización de cobro recurrente.", "Aceite a autorização de cobrança recorrente."],
  "You already signed this agreement.": ["Usted ya firmó este acuerdo.", "Você já assinou este acordo."],
  "This addendum was updated by the office. Please close it, open it again, and read the current text before signing.": ["La oficina actualizó este anexo. Ciérrelo, ábralo de nuevo y lea el texto actual antes de firmar.", "O escritório atualizou este aditivo. Feche, abra de novo e leia o texto atual antes de assinar."],
  "This addendum was already signed or changed. Please reload the page.": ["Este anexo ya se firmó o cambió. Vuelva a cargar la página.", "Este aditivo já foi assinado ou alterado. Recarregue a página."],
  "The signed copy isn't ready. Please contact the office.": ["La copia firmada no está lista. Comuníquese con la oficina.", "A cópia assinada não está pronta. Fale com o escritório."],
  "The office withdrew this agreement.": ["La oficina retiró este acuerdo.", "O escritório retirou este acordo."],
  "That photo is too large (max 10 MB).": ["La foto es demasiado grande (máximo 10 MB).", "A foto é grande demais (máximo 10 MB)."],
  "Only photos (JPG, PNG, WebP, HEIC).": ["Solo fotos (JPG, PNG, WebP, HEIC).", "Somente fotos (JPG, PNG, WebP, HEIC)."],
  "Please upload a photo (JPG, PNG, WEBP, HEIC) or a PDF.": ["Suba una foto (JPG, PNG, WEBP, HEIC) o un PDF.", "Envie uma foto (JPG, PNG, WEBP, HEIC) ou um PDF."],
  "File is empty or too large (15MB max).": ["El archivo está vacío o es demasiado grande (máximo 15 MB).", "O arquivo está vazio ou é grande demais (máximo 15 MB)."],
  "Could not upload the photo.": ["No se pudo subir la foto.", "Não foi possível enviar a foto."],
  "Could not upload file: {detail}": ["No se pudo subir el archivo: {detail}", "Não foi possível enviar o arquivo: {detail}"],
  "Could not generate a link for this file.": ["No se pudo generar un enlace para este archivo.", "Não foi possível gerar um link para este arquivo."],
  "Could not open the PDF.": ["No se pudo abrir el PDF.", "Não foi possível abrir o PDF."],
  "This lease has no PDF on file.": ["Este contrato no tiene PDF registrado.", "Este contrato não tem PDF cadastrado."],
  "Up to 10 photos per request.": ["Hasta 10 fotos por solicitud.", "Até 10 fotos por solicitação."],
  "Up to 8 photos per item.": ["Hasta 8 fotos por artículo.", "Até 8 fotos por item."],
  "Not available yet.": ["Todavía no está disponible.", "Ainda não está disponível."],
  "Document not found.": ["No se encontró el documento.", "Documento não encontrado."],
  "Invoice not found.": ["No se encontró la factura.", "Fatura não encontrada."],
  "Listing not found.": ["No se encontró el anuncio.", "Anúncio não encontrado."],
  "Vehicle not found.": ["No se encontró el vehículo.", "Veículo não encontrado."],
  "Occupant not found.": ["No se encontró a la persona.", "Pessoa não encontrada."],
  "Request not found.": ["No se encontró la solicitud.", "Solicitação não encontrada."],
  "Order not found.": ["No se encontró el pedido.", "Pedido não encontrado."],
  "No lease found.": ["No se encontró un contrato.", "Nenhum contrato encontrado."],
  "Lease not found.": ["No se encontró el contrato.", "Contrato não encontrado."],
  "Push is not set up yet.": ["Las alertas todavía no están configuradas.", "Os alertas ainda não estão configurados."],
  "Invalid subscription.": ["Suscripción no válida.", "Inscrição inválida."],
  "Could not load your propane orders.": ["No se pudieron cargar sus pedidos de propano.", "Não foi possível carregar seus pedidos de propano."],
};
