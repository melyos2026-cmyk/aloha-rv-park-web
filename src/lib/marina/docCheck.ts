import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { todayET } from "./data";

// Oct 26 (per Mely — "el sistema deberia aceptarla sin que tenga que esperar por un empleado"):
// read the document the boater uploaded (photo or PDF) and decide:
//   · approved  → date in the future, right kind of document, the name and the boat match
//                 (and, if the marina asks, the marina is "additional insured" / minimum liability)
//   · rejected  → expired or unreadable: the boater is told right away what to upload instead
//   · pending   → anything else (e.g. the owner is an LLC, the boat name differs): the office decides
// The system checks that the facts match; like a person looking at it, it can't prove a document
// isn't forged. Everything it read is saved (ai_check) so the office can see why.

export type Extracted = {
  readable: boolean; doc_type: string | null; expires_on: string | null; holder_names: string[]; boat_name: string | null;
  hull_id: string | null; registration_number: string | null; length_ft: number | null; additional_insured: string[];
  liability_amount: number | null; issuer: string | null; notes: string | null;
};
export type CheckResult = { decision: "approved" | "rejected" | "pending"; reasons: string[]; note: string | null; expires_on: string | null; extracted: Extracted | null; checks: { label: string; ok: boolean | null; detail: string }[] };
export type DocSettings = { auto: boolean; requireAdditionalInsured: boolean; minLiability: number | null };

export async function docSettings(companyId: string): Promise<DocSettings> {
  const { data, error } = await supabaseAdmin.from("marina_booking_settings").select("*").eq("company_id", companyId).maybeSingle();
  const d: any = error ? null : data;
  return { auto: d?.docs_auto_approve !== false, requireAdditionalInsured: !!d?.require_additional_insured, minLiability: Number(d?.min_liability) > 0 ? Number(d.min_liability) : null };
}

const LABEL: Record<string, string> = { insurance: "insurance", registration: "registration", id: "ID", survey: "survey", other: "document" };
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const compact = (s: unknown) => norm(s).replace(/ /g, "");

async function prepare(buf: Buffer, type: string): Promise<{ kind: "image" | "document"; media: string; data: string } | null> {
  if (type === "application/pdf") return buf.length <= 20 * 1024 * 1024 ? { kind: "document", media: "application/pdf", data: buf.toString("base64") } : null;
  try {
    const out = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { kind: "image", media: "image/jpeg", data: out.toString("base64") };
  } catch {
    return null; // e.g. a HEIC photo the server can't open: the office looks at it
  }
}

export async function readDocument(buf: Buffer, type: string): Promise<Extracted | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const file = await prepare(buf, type);
  if (!file) return null;
  const prompt = `You read boat documents for a marina office. Look at this file and answer ONLY with one JSON object, no other text:
{"readable": true|false (false if blurry, cut off, too dark, or not a document),
 "doc_type": "insurance" | "registration" | "id" | "survey" | "other",
 "expires_on": "YYYY-MM-DD" or null (insurance: policy expiration / end of policy period; registration: expiration; ID: expiration),
 "holder_names": [every person or company named as the insured, owner, registrant or ID holder],
 "boat_name": vessel name or null, "hull_id": hull identification number (HIN) or null, "registration_number": e.g. "FL 1234 AB" or null,
 "length_ft": vessel length in feet as a number or null,
 "additional_insured": [names listed as additional insured / certificate holder / loss payee],
 "liability_amount": liability / P&I limit in dollars as a number or null,
 "issuer": insurance company or issuing state/agency or null,
 "notes": anything odd in one short sentence, or null}
Copy what is printed; do not guess. Dates printed as MM/DD/YYYY must be converted to YYYY-MM-DD.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5", max_tokens: 700,
        messages: [{ role: "user", content: [{ type: file.kind, source: { type: "base64", media_type: file.media, data: file.data } }, { type: "text", text: prompt }] }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { console.error("doc check: Anthropic error", j?.error?.message); return null; }
    const text: string = (j.content || []).find((b: any) => b.type === "text")?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const x = JSON.parse(m[0]);
    const arr = (v: any) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 10) : []);
    const num = (v: any) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
    return {
      readable: x.readable !== false, doc_type: typeof x.doc_type === "string" ? x.doc_type : null,
      expires_on: /^\d{4}-\d{2}-\d{2}$/.test(String(x.expires_on || "")) ? String(x.expires_on) : null,
      holder_names: arr(x.holder_names), boat_name: x.boat_name ? String(x.boat_name).slice(0, 120) : null, hull_id: x.hull_id ? String(x.hull_id).slice(0, 40) : null,
      registration_number: x.registration_number ? String(x.registration_number).slice(0, 40) : null, length_ft: num(x.length_ft),
      additional_insured: arr(x.additional_insured), liability_amount: num(x.liability_amount), issuer: x.issuer ? String(x.issuer).slice(0, 120) : null, notes: x.notes ? String(x.notes).slice(0, 300) : null,
    };
  } catch (e: any) { console.error("doc check failed:", e?.message); return null; }
}

// Same person? Last name must appear, plus the first name or its initial.
function nameMatches(owner: string, names: string[]) {
  const parts = norm(owner).split(" ").filter((p) => p.length > 1);
  if (!parts.length) return false;
  const last = parts[parts.length - 1], first = parts[0];
  return names.some((n) => {
    const t = norm(n).split(" ");
    return t.includes(last) && (t.includes(first) || t.some((w) => w[0] === first[0]));
  });
}

export function verify(x: Extracted | null, want: { type: string; owner: string; boat: { name?: string | null; length?: number | null; hull_id?: string | null; registration?: string | null } | null; marina: string; settings: DocSettings }): CheckResult {
  const today = todayET();
  const checks: CheckResult["checks"] = [];
  const label = LABEL[want.type] || "document";
  if (!x) return { decision: "pending", reasons: ["The system couldn't read this file automatically."], note: null, expires_on: null, extracted: null, checks };
  if (!x.readable) return { decision: "rejected", reasons: ["The photo can't be read."], note: "We couldn't read this photo. Take it again in good light with the whole document visible, or upload the PDF.", expires_on: null, extracted: x, checks: [{ label: "Readable", ok: false, detail: "Blurry, cut off or not a document" }] };

  const typeOk = !x.doc_type || x.doc_type === want.type || (want.type === "other");
  checks.push({ label: "Kind of document", ok: typeOk, detail: typeOk ? `Looks like ${LABEL[x.doc_type || want.type] || "a document"}` : `Looks like ${LABEL[x.doc_type || ""] || x.doc_type}, not ${label}` });

  const needsDate = ["insurance", "registration", "id"].includes(want.type);
  const exp = x.expires_on;
  if (needsDate) checks.push({ label: "Expiration", ok: !!exp && exp > today, detail: exp ? (exp > today ? `Valid until ${exp}` : `Expired on ${exp}`) : "No expiration date found" });
  if (needsDate && exp && exp <= today) {
    return { decision: "rejected", reasons: [`Expired on ${exp}.`], note: `This ${label} expired on ${exp}. Please upload the current one.`, expires_on: exp, extracted: x, checks };
  }

  const nameOk = nameMatches(want.owner, x.holder_names);
  checks.push({ label: "Name", ok: nameOk, detail: nameOk ? `Matches ${want.owner}` : x.holder_names.length ? `Shows ${x.holder_names.join(", ")} (account: ${want.owner})` : "No name found" });

  if (want.type === "insurance" || want.type === "registration" || want.type === "survey") {
    const b = want.boat;
    let boatOk: boolean | null = null, why = "No boat on file to compare";
    if (b) {
      const byName = !!b.name && !!x.boat_name && (compact(b.name) === compact(x.boat_name) || compact(x.boat_name).includes(compact(b.name)) || compact(b.name).includes(compact(x.boat_name)));
      const byHull = !!b.hull_id && !!x.hull_id && compact(b.hull_id) === compact(x.hull_id);
      const byReg = !!b.registration && !!x.registration_number && compact(b.registration) === compact(x.registration_number);
      const byLen = !!b.length && !!x.length_ft && Math.abs(Number(b.length) - x.length_ft) <= 2;
      boatOk = byName || byHull || byReg || byLen;
      why = boatOk ? [byName && "name", byHull && "hull ID", byReg && "registration number", byLen && "length"].filter(Boolean).join(", ") + " match" : `Document shows ${[x.boat_name, x.length_ft && `${x.length_ft} ft`, x.hull_id].filter(Boolean).join(" · ") || "no boat details"}`;
    }
    checks.push({ label: "Boat", ok: boatOk, detail: why });
  }
  if (want.type === "insurance" && want.settings.requireAdditionalInsured) {
    const words = norm(want.marina).split(" ").filter((w) => w.length > 2 && !["marina", "the", "and"].includes(w));
    const ok = x.additional_insured.some((n) => { const t = norm(n); return t.includes(norm(want.marina)) || (words.length > 0 && words.every((w) => t.includes(w))); });
    checks.push({ label: "Marina as additional insured", ok, detail: ok ? "Listed" : x.additional_insured.length ? `Lists ${x.additional_insured.join(", ")}` : "Not listed" });
  }
  if (want.type === "insurance" && want.settings.minLiability) {
    const ok = !!x.liability_amount && x.liability_amount >= want.settings.minLiability;
    checks.push({ label: "Liability", ok, detail: x.liability_amount ? `$${x.liability_amount.toLocaleString()} (minimum $${want.settings.minLiability.toLocaleString()})` : "Amount not found" });
  }
  const failed = checks.filter((c) => c.ok === false);
  if (!failed.length && (!needsDate || exp)) return { decision: "approved", reasons: [], note: null, expires_on: exp, extracted: x, checks };
  return { decision: "pending", reasons: failed.map((c) => `${c.label}: ${c.detail}`), note: null, expires_on: exp, extracted: x, checks };
}

// Run the check on a saved document row and apply the decision. Returns what the boater sees.
export async function autoCheckDocument(p: { companyId: string; marinaName: string; docId: string; buf: Buffer; type: string; docType: string; owner: string; boat: { name?: string | null; length?: number | null; hull_id?: string | null; registration?: string | null } | null }) {
  const settings = await docSettings(p.companyId);
  if (!settings.auto) return { decision: "pending" as const, message: "Thank you! The office will review it." };
  const x = await readDocument(p.buf, p.type);
  const r = verify(x, { type: p.docType, owner: p.owner, boat: p.boat, marina: p.marinaName, settings });
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ai_check: { extracted: r.extracted, checks: r.checks, reasons: r.reasons, at: now } };
  if (r.decision === "approved") Object.assign(patch, { status: "approved", expires_on: r.expires_on, auto_approved: true, reviewed_by_name: "Automatic check", reviewed_at: now });
  if (r.decision === "rejected") Object.assign(patch, { status: "rejected", review_note: r.note, auto_approved: false, reviewed_by_name: "Automatic check", reviewed_at: now, ...(r.expires_on ? { expires_on: r.expires_on } : {}) });
  const { error } = await supabaseAdmin.from("marina_boat_documents").update(patch).eq("id", p.docId).eq("company_id", p.companyId);
  if (error) return { decision: "pending" as const, message: "Thank you! The office will review it." };
  const label = LABEL[p.docType] || "document";
  return {
    decision: r.decision,
    message: r.decision === "approved" ? `Approved! Your ${label} is on file${r.expires_on ? ` until ${r.expires_on}` : ""}.`
      : r.decision === "rejected" ? r.note || "Please upload it again."
      : `Thank you! The office will review it (${r.reasons[0] || "it needs a quick look"}).`,
    reasons: r.reasons,
  };
}
