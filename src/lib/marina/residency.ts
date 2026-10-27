import sharp from "sharp";
import { todayET } from "./data";

// Oct 27 (per Mely — "que el sistema AI pueda leer la foto como con el seguro y si es, aprueba"):
// proof of residency for the resident rate, the way municipal marinas do it (e.g. St. Augustine
// Municipal Marina): an ID with the address in the marina's city/county (driver's license, state ID
// or vehicle registration) and, if the marina asks, two more documents (lease, utility bill, deed,
// voter card) with the same name and address. The system reads them and decides:
//   approved → readable, right kind, not expired, the name matches, the address is in the area
//   rejected → unreadable or expired (the guest is told what to upload)
//   pending  → anything else: the office decides in Document Review
// Like a person looking at it, it checks that the facts match; it can't prove a document isn't forged.

export type ResDoc = {
  readable: boolean; kind: string | null; holder_names: string[]; street: string | null; city: string | null; state: string | null;
  zip: string | null; county: string | null; expires_on: string | null; issued_on: string | null; in_area: boolean | null; notes: string | null;
};
export type ResCheck = { label: string; ok: boolean | null; detail: string };
export type ResResult = { decision: "approved" | "pending" | "rejected"; checks: ResCheck[]; message: string; address: string | null; expires_on: string | null; docs: (ResDoc | null)[] };

const ID_KINDS = ["driver_license", "state_id", "vehicle_registration"];
const SUPPORT_KINDS = ["lease", "utility_bill", "property", "voter_registration", "bank_statement", "tax_bill"];
const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function prepare(buf: Buffer, type: string) {
  if (type === "application/pdf") return buf.length <= 20 * 1024 * 1024 ? { kind: "document", media: "application/pdf", data: buf.toString("base64") } : null;
  try {
    const out = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { kind: "image", media: "image/jpeg", data: out.toString("base64") };
  } catch {
    if (["image/jpeg", "image/png", "image/webp"].includes(type) && buf.length <= 4.5 * 1024 * 1024) return { kind: "image", media: type, data: buf.toString("base64") };
    return null;
  }
}

export async function readResidencyDoc(buf: Buffer, type: string, area: string | null): Promise<ResDoc | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const file = await prepare(buf, type);
  if (!file) return null;
  const prompt = `You check proof of residency for a marina office. Look at this file and answer ONLY with one JSON object, no other text:
{"readable": true|false (false if blurry, cut off, too dark or not a document),
 "kind": "driver_license" | "state_id" | "vehicle_registration" | "lease" | "utility_bill" | "property" | "voter_registration" | "bank_statement" | "tax_bill" | "other",
 "holder_names": [every person named as the holder, owner, tenant or account holder],
 "street": street address or null, "city": city or null, "state": two-letter state or null, "zip": 5-digit ZIP or null, "county": county if printed or null,
 "expires_on": "YYYY-MM-DD" or null (IDs and registrations), "issued_on": "YYYY-MM-DD" or null (bill/statement date, lease start, issue date),
 "in_area": ${area ? `true if this address is inside ${JSON.stringify(area)}, false if it clearly is not, null if you can't tell` : "null"},
 "notes": anything odd in one short sentence, or null}
Copy what is printed; do not guess. Dates printed as MM/DD/YYYY must be converted to YYYY-MM-DD.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 600, messages: [{ role: "user", content: [{ type: file.kind, source: { type: "base64", media_type: file.media, data: file.data } }, { type: "text", text: prompt }] }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const text: string = (j.content || []).find((b: any) => b.type === "text")?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const x = JSON.parse(m[0]);
    const str = (v: any, n = 120) => (v ? String(v).slice(0, n) : null);
    const date = (v: any) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    return {
      readable: x.readable === true, kind: str(x.kind, 40), holder_names: Array.isArray(x.holder_names) ? x.holder_names.map(String).slice(0, 8) : [],
      street: str(x.street), city: str(x.city), state: str(x.state, 4), zip: /^\d{5}/.test(String(x.zip || "")) ? String(x.zip).slice(0, 5) : null, county: str(x.county),
      expires_on: date(x.expires_on), issued_on: date(x.issued_on), in_area: typeof x.in_area === "boolean" ? x.in_area : null, notes: str(x.notes, 300),
    };
  } catch { return null; }
}

export function nameMatches(owner: string, names: string[]) {
  const parts = norm(owner).split(" ").filter((p) => p.length > 1);
  if (!parts.length) return false;
  const last = parts[parts.length - 1], first = parts[0];
  return names.some((n) => { const t = norm(n).split(" "); return parts.length > 1 && t.includes(last) && t.includes(first); }); // full first + last name
}
const sameAddress = (a: ResDoc, b: ResDoc) => !!a.zip && a.zip === b.zip && !!a.street && !!b.street && norm(a.street).split(" ")[0] === norm(b.street).split(" ")[0];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function verifyResidency(docs: (ResDoc | null)[], p: { fullName: string; area: string | null; zips: string[]; needSupport: boolean }): ResResult {
  const today = todayET();
  const checks: ResCheck[] = [];
  const [id, ...support] = docs;
  const addr = id ? [id.street, id.city, [id.state, id.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null : null;
  if (!id) return { decision: "pending", checks: [{ label: "Readable", ok: null, detail: "The system couldn't read the ID automatically." }], message: "Thank you! The office will check your ID.", address: null, expires_on: null, docs };
  if (!id.readable) return { decision: "rejected", checks: [{ label: "Readable", ok: false, detail: "Blurry, cut off or not a document" }], message: "We couldn't read that photo. Take it again in good light with the whole ID visible.", address: null, expires_on: null, docs };
  const kindOk = !!id.kind && ID_KINDS.includes(id.kind);
  checks.push({ label: "Kind of ID", ok: kindOk, detail: kindOk ? id.kind!.replace(/_/g, " ") : `Looks like ${id.kind || "something else"} (needs a driver's license, state ID or vehicle registration)` });
  if (id.expires_on && id.expires_on <= today) {
    checks.push({ label: "Expiration", ok: false, detail: `Expired on ${id.expires_on}` });
    return { decision: "rejected", checks, message: `That ID expired on ${id.expires_on}. Please upload a current one.`, address: addr, expires_on: id.expires_on, docs };
  }
  checks.push({ label: "Expiration", ok: id.expires_on ? true : null, detail: id.expires_on ? `Valid until ${id.expires_on}` : "No expiration date found" });
  const nameOk = nameMatches(p.fullName, id.holder_names);
  checks.push({ label: "Name", ok: nameOk, detail: nameOk ? `Matches ${p.fullName}` : `Shows ${id.holder_names.join(", ") || "no name"} (booking: ${p.fullName})` });
  // in the area: the marina's ZIP list decides when it has one; otherwise the reader's judgement
  const zipOk = p.zips.length ? (id.zip ? p.zips.includes(id.zip) : null) : null;
  const areaOk = zipOk !== null ? zipOk : id.in_area;
  checks.push({ label: "Address in the area", ok: areaOk, detail: `${addr || "No address found"}${p.area ? ` — ${p.area}` : ""}${zipOk === false ? " (ZIP not on the marina's list)" : ""}` });
  if (areaOk === false) return { decision: "rejected", checks, message: `The address on this ID (${addr || "not found"}) isn't in ${p.area || "the marina's resident area"}, so the regular rate applies.`, address: addr, expires_on: id.expires_on, docs };
  if (p.needSupport) {
    const good = support.filter((d): d is ResDoc => !!d && d.readable && !!d.kind && SUPPORT_KINDS.includes(d.kind) && nameMatches(p.fullName, d.holder_names) && sameAddress(d, id)
      && (d.kind !== "utility_bill" && d.kind !== "bank_statement" || (!!d.issued_on && d.issued_on >= addDays(today, -90))));
    checks.push({ label: "Two more documents", ok: good.length >= 2 ? true : support.filter(Boolean).length >= 2 ? false : null, detail: `${good.length} of 2 with the same name and address${support.some((d) => d?.kind === "utility_bill") ? " (bills: last 90 days)" : ""}` });
  }
  const failed = checks.filter((c) => c.ok === false);
  const unknown = checks.filter((c) => c.ok === null && c.label !== "Expiration");
  // Oct 27 (review): approved by itself only when the marina's ZIP list confirms the address — the
  // reader's own opinion of "in the area" is never enough on its own.
  if (!failed.length && !unknown.length && kindOk && nameOk && areaOk === true && zipOk === true) return { decision: "approved", checks, message: "Approved! You get the resident rate.", address: addr, expires_on: id.expires_on, docs };
  const first = failed[0] || unknown[0];
  return { decision: "pending", checks, message: `Thank you! The office will confirm your residency${first ? ` (${first.label.toLowerCase()}: ${first.detail})` : ""} and email you, usually within a business day. Then book with the resident rate — or book now at the regular rate.`, address: addr, expires_on: id.expires_on, docs };
}
