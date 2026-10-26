import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { sniff } from "@/lib/marina/fileType";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { loadRequestByLink } from "@/lib/marina/slipRequests";
import { mailOffice } from "@/lib/marina/slipAuto";

// Oct 26 (per Mely): a boater who is new to the marina has no boat on file yet, so they send
// insurance, registration and ID with their slip request, from the private tracker page.
// POST multipart { number, t, doc_type, expires_on, file } → private bucket, "pending" for the
// office's Document Review. When the office sends the contract the documents move to the boat.

const TYPES = ["insurance", "registration", "id", "survey", "other"];
const LABEL: Record<string, string> = { insurance: "Insurance", registration: "Registration", id: "ID", survey: "Survey", other: "Document" };

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `srdocs:${company.id}`, 20)) return NextResponse.json({ error: "Too many uploads. Please try again later." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const r = await loadRequestByLink(company.id, String(form?.get("number") || ""), String(form?.get("t") || ""));
  if (!r) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (["declined", "cancelled"].includes(r.status)) return NextResponse.json({ error: "This request is closed." }, { status: 409 });
  const type = String(form?.get("doc_type") || "");
  const exp = String(form?.get("expires_on") || "");
  const file = form?.get("file");
  if (!TYPES.includes(type)) return NextResponse.json({ error: "Choose what document this is." }, { status: 400 });
  if (!file || typeof file === "string") return NextResponse.json({ error: "Take a photo or choose the file." }, { status: 400 });
  if ((type === "insurance" || type === "registration") && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) return NextResponse.json({ error: "Enter the expiration date shown on the document." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
  const { count } = await supabaseAdmin.from("marina_boat_documents").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("request_id", r.id);
  if ((count || 0) >= 15) return NextResponse.json({ error: "You already sent many documents. The office will contact you if something is missing." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP, HEIC) or a PDF." }, { status: 400 });
  const path = `${company.id}/requests/${r.id}/boater-${Date.now()}.${kind.ext}`;
  const up = await supabaseAdmin.storage.from("marina-documents").upload(path, buf, { contentType: kind.type });
  if (up.error) return NextResponse.json({ error: "Could not upload. Please try again." }, { status: 500 });
  const boatLabel = r.boat_name || `${r.boat_length_ft} ft boat`;
  const { error } = await supabaseAdmin.from("marina_boat_documents").insert({
    company_id: company.id, boat_id: r.boat_id || null, request_id: r.id, doc_type: type, file_name: `${LABEL[type]} — ${boatLabel}.${kind.ext}`, file_path: path,
    expires_on: /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null, status: "pending", uploaded_by: "boater",
  });
  if (error) {
    await supabaseAdmin.storage.from("marina-documents").remove([path]).then(() => null, () => null);
    return NextResponse.json({ error: /request_id|boat_id/.test(error.message) ? "Document uploads with requests are not set up yet. Please email them to the office." : "Could not save the document." }, { status: 500 });
  }
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: r.full_name, update_type: "boat_document", message: `${r.full_name} sent ${LABEL[type].toLowerCase()} with slip request ${r.request_number}. Review it in Document Review.` }).then(() => null, () => null);
  await mailOffice(company, `New document to review: ${LABEL[type]} from ${r.full_name}`, [`<b>${String(r.full_name).replace(/[<>&"]/g, "")}</b> sent their ${LABEL[type].toLowerCase()} with slip request ${r.request_number}. Approve it or send it back in Document Review.`]);
  return NextResponse.json({ ok: true });
}
