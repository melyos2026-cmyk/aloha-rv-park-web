import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { sniff } from "@/lib/marina/fileType";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { todayET } from "@/lib/marina/data";
import { mailOffice } from "@/lib/marina/slipAuto";
import { autoCheckDocument, docSettings } from "@/lib/marina/docCheck";

// Oct 26 (per Mely — "paperwork comes to you"): the boater's documents in Boater login.
// GET → each boat: what the marina needs (insurance, registration), what's on file, what's waiting
// for review or was sent back. POST (multipart: boat_id, doc_type, expires_on, file) → uploads to
// the private marina-documents bucket as "pending" for the office's Document Review.

export const maxDuration = 60; // reading the document takes a few seconds

const TYPES = ["insurance", "registration", "id", "survey", "other"];

async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return null;
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return null;
  return { company, memberId: s.memberId };
}

export async function GET(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [{ data: boats }, { data: setting }] = await Promise.all([
    supabaseAdmin.from("marina_boats").select("id, boat_name").eq("company_id", w.company.id).eq("member_id", w.memberId).order("boat_name"),
    supabaseAdmin.from("company_modules").select("enabled").eq("company_id", w.company.id).eq("module_name", "marina_require_insurance").maybeSingle(),
  ]);
  const ids = (boats || []).map((b: any) => b.id);
  let docs: any[] = [];
  if (ids.length) {
    const r = await supabaseAdmin.from("marina_boat_documents").select("id, boat_id, doc_type, file_name, expires_on, status, review_note, created_at").eq("company_id", w.company.id).in("boat_id", ids).neq("doc_type", "contract").order("created_at", { ascending: false });
    if (r.error) { const r2 = await supabaseAdmin.from("marina_boat_documents").select("id, boat_id, doc_type, file_name, expires_on, created_at").eq("company_id", w.company.id).in("boat_id", ids).neq("doc_type", "contract"); docs = (r2.data || []).map((d: any) => ({ ...d, status: "approved" })); }
    else docs = r.data || [];
  }
  const today = todayET();
  const soon = new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const required = [...(setting?.enabled === false ? [] : ["insurance"]), "registration"];
  const out = (boats || []).map((b: any) => {
    const mine = docs.filter((d) => d.boat_id === b.id);
    const needs = required.map((t) => {
      const of = mine.filter((d) => d.doc_type === t);
      const ok = of.find((d) => d.status === "approved" && (!d.expires_on || d.expires_on >= today));
      const pending = of.find((d) => d.status === "pending");
      const rejected = of.find((d) => d.status === "rejected");
      const state = ok ? (ok.expires_on && ok.expires_on <= soon ? "expiring" : "ok") : pending ? "pending" : rejected && (!of.find((d) => d.status === "approved")) ? "rejected" : of.some((d) => d.status === "approved") ? "expired" : "missing";
      return { type: t, state, expires_on: ok?.expires_on || null, note: rejected && state === "rejected" ? rejected.review_note : null };
    });
    return { id: b.id, name: b.boat_name, needs, docs: mine.map((d) => ({ id: d.id, type: d.doc_type, name: d.file_name, expires_on: d.expires_on, status: d.status, note: d.review_note, at: d.created_at })) };
  });
  return NextResponse.json({ boats: out });
}

export async function POST(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (await tooManyFromIp(req, `docs:${w.company.id}`, 20)) return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const boatId = String(form?.get("boat_id") || "");
  const type = String(form?.get("doc_type") || "");
  const exp = String(form?.get("expires_on") || "");
  const file = form?.get("file");
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Choose what document this is." }, { status: 400 });
  if (!file || typeof file === "string") return NextResponse.json({ error: "Take a photo or choose the file." }, { status: 400 });
  const autoDocs = (await docSettings(w.company.id)).auto;
  if (!autoDocs && (type === "insurance" || type === "registration") && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) return NextResponse.json({ error: "Enter the expiration date shown on the document." }, { status: 400 });
  const { data: boat } = await supabaseAdmin.from("marina_boats").select("*").eq("id", boatId).eq("company_id", w.company.id).eq("member_id", w.memberId).maybeSingle();
  if (!boat) return NextResponse.json({ error: "Boat not found." }, { status: 404 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP, HEIC) or a PDF." }, { status: 400 });
  const path = `${w.company.id}/${boat.id}/boater-${Date.now()}.${kind.ext}`;
  const up = await supabaseAdmin.storage.from("marina-documents").upload(path, buf, { contentType: kind.type });
  if (up.error) return NextResponse.json({ error: "Could not upload. Please try again." }, { status: 500 });
  const label = type === "insurance" ? "Insurance" : type === "registration" ? "Registration" : type === "id" ? "ID" : type === "survey" ? "Survey" : "Document";
  const { data: row, error } = await supabaseAdmin.from("marina_boat_documents").insert({
    company_id: w.company.id, boat_id: boat.id, doc_type: type, file_name: `${label} — ${boat.boat_name}.${kind.ext}`, file_path: path,
    expires_on: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null, status: "pending", uploaded_by: "boater",
  }).select("id").single();
  if (error) {
    await supabaseAdmin.storage.from("marina-documents").remove([path]).then(() => null, () => null);
    return NextResponse.json({ error: /status|uploaded_by/.test(error.message) ? "Document uploads are not set up yet. Please email it to the office." : "Could not save the document." }, { status: 500 });
  }
  const { data: m } = await supabaseAdmin.from("marina_members").select("full_name").eq("id", w.memberId).maybeSingle();
  // Oct 26 (per Mely): read it now; approved at once when everything matches.
  const check = await autoCheckDocument({ companyId: w.company.id, marinaName: w.company.company_name, docId: row.id, buf, type: kind.type, docType: type, owner: m?.full_name || "", boat: { id: boat.id, name: boat.boat_name, length: boat.length_ft, hull_id: boat.hull_id, registration: boat.registration_number }, otherBoats: ((await supabaseAdmin.from("marina_boats").select("id, boat_name, length_ft, hull_id, registration_number").eq("company_id", w.company.id).eq("member_id", w.memberId).neq("id", boat.id)).data || []).map((o: any) => ({ id: o.id, name: o.boat_name, length: o.length_ft, hull_id: o.hull_id, registration: o.registration_number })), notify: { memberId: w.memberId, email: (await supabaseAdmin.from("marina_members").select("email").eq("id", w.memberId).maybeSingle()).data?.email || null } }).catch(() => ({ decision: "pending" as const, message: "Thank you! The office will review it." }));
  if (check.decision !== "pending") return NextResponse.json({ ok: true, decision: check.decision, message: check.message });
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: w.company.id, resident_name: m?.full_name || "Boater", update_type: "boat_document", message: `${m?.full_name || "A boater"} uploaded ${label.toLowerCase()} for ${boat.boat_name}. Review it in Document Review.` }).then(() => null, () => null);
  await mailOffice(w.company, `New document to review: ${label} for ${boat.boat_name}`, [`<b>${String(m?.full_name || "A boater").replace(/[<>&"]/g, "")}</b> uploaded the ${label.toLowerCase()} for ${String(boat.boat_name).replace(/[<>&"]/g, "")}.`, ...("reasons" in check && check.reasons?.length ? [`The automatic check needs you: ${check.reasons.map((x) => String(x).replace(/[<>&"]/g, "")).join("; ")}.`] : []), "Approve it or send it back in Document Review."]);
  return NextResponse.json({ ok: true, decision: "pending", message: check.message });
}
