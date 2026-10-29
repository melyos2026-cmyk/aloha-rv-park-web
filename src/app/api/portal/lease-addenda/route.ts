import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession, getPortalSession } from "@/lib/portalSession";
import { buildSignedContractPdf } from "@/lib/marina/contractPdf";

// Oct 28 (per Mely): Lease Addenda — the park (melyos-builder → Lease Addenda) sends residents who
// signed PAPER leases an addendum (first one: "Lease Addendum — Returned Payments"); the resident
// reads and signs it here. Same e-sign pattern as the marina contracts (api/marina/contracts):
// the text was frozen when sent (body + body_sha256), the signer types their full name exactly as
// on file (adopted signature image), and name, date, IP and device are stored with the signature.
// The signed PDF goes in the resident's Documents (resident_documents, type "lease_addendum").
//  GET  ?residentId=                → { addenda: [...] } (pending + signed; [] if the table is missing)
//  GET  ?residentId=&pdf=<id>       → { url } 5-minute link to the signed PDF
//  POST { residentId, id, action: "view" }
//  POST { residentId, id, action: "sign", name, agree, bodySha256, signature, signature_style }
// SECURITY: the signed portal session must match residentId; every query is scoped to that
// resident AND their company.

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || /does not exist|could not find the table|schema cache/i.test(String(e.message || "")));
// Oct 28 (per Mely): the LANDLORD signature is a park manager's own adopted signature — never MelyOS's.
// While an addendum is waiting, it shows the park manager's CURRENT signature (blank until one exists);
// it is frozen into the record the moment the resident signs.
async function parkSigner(companyId: string): Promise<{ name: string; title: string | null; signature: string } | null> {
  const { data } = await supabase.from("admin_users").select("*").eq("company_id", companyId);
  const ok = (data || []).filter((m: any) => m.signature_image && m.role !== "master_admin" && m.can_manage_money === true);
  const m: any = ok.find((x: any) => x.role === "park_admin") || ok[0];
  return m ? { name: m.full_name || m.email || "Park manager", title: m.signature_title || null, signature: m.signature_image } : null;
}

const LIST_COLS = "id, addendum_type, title, body, body_sha256, status, effective_date, lot_name, sent_at, last_sent_at, sent_by_name, sent_by_title, sent_by_signature, viewed_at, signed_at, signer_name, signature_image, pdf_path, document_id";

async function who(req: NextRequest, residentId: string | null) {
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return { error: authError };
  const session = await getPortalSession(req);
  const { data: resident } = await supabase.from("resident_accounts")
    .select("id, company_id, full_name, email, deleted_at").eq("id", residentId!).maybeSingle();
  if (!resident || resident.deleted_at || (session?.companyId && resident.company_id !== session.companyId)) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  return { resident: resident as { id: string; company_id: string; full_name: string; email: string | null } };
}

export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  const w = await who(req, residentId);
  if (w.error) return w.error;
  const r = w.resident!;

  const pdfOf = req.nextUrl.searchParams.get("pdf");
  if (pdfOf) {
    const { data: a } = await supabase.from("resident_lease_addenda").select("pdf_path")
      .eq("id", pdfOf).eq("company_id", r.company_id).eq("resident_id", r.id).eq("status", "signed").maybeSingle();
    if (!a?.pdf_path) return NextResponse.json({ error: "The signed copy isn't ready. Please contact the office." }, { status: 404 });
    const { data: signed } = await supabase.storage.from("resident-documents").createSignedUrl(a.pdf_path, 300);
    if (!signed) return NextResponse.json({ error: "Could not open the PDF." }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl });
  }

  const { data, error } = await supabase.from("resident_lease_addenda").select(LIST_COLS)
    .eq("company_id", r.company_id).eq("resident_id", r.id).in("status", ["pending", "signed"])
    .order("sent_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ addenda: [] }); // table not created yet on this database
  const signer = (data || []).some((a: any) => a.status === "pending") ? await parkSigner(r.company_id) : null;
  const { data: co } = await supabase.from("companies").select("company_name, dba_name, legal_name").eq("id", r.company_id).maybeSingle();
  const landlord = String((co as any)?.legal_name || (co as any)?.dba_name || (co as any)?.company_name || "");
  return NextResponse.json({
    fullName: r.full_name,
    landlord,
    addenda: (data || []).map((a: any) => ({
      ...a, hasPdf: !!a.pdf_path, pdf_path: undefined, signature_image: a.status === "signed" ? a.signature_image : null,
      ...(a.status === "pending" ? { sent_by_name: signer?.name || null, sent_by_title: signer?.title || null, sent_by_signature: signer?.signature || null } : {}),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let b: any = {};
  try { b = await req.json(); } catch {}
  const w = await who(req, b.residentId ? String(b.residentId) : null);
  if (w.error) return w.error;
  const r = w.resident!;

  const { data: a, error: readErr } = await supabase.from("resident_lease_addenda").select("*")
    .eq("id", String(b.id || "")).eq("company_id", r.company_id).eq("resident_id", r.id).maybeSingle();
  if (readErr && missingTable(readErr)) return NextResponse.json({ error: "Not available yet." }, { status: 404 });
  if (!a) return NextResponse.json({ error: "Addendum not found." }, { status: 404 });

  if (b.action === "view") {
    if (a.status === "pending" && !a.viewed_at) await supabase.from("resident_lease_addenda").update({ viewed_at: new Date().toISOString() }).eq("id", a.id).is("viewed_at", null);
    return NextResponse.json({ ok: true });
  }
  if (b.action !== "sign") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  if (a.status === "signed") return NextResponse.json({ error: "You already signed this agreement." }, { status: 400 });
  if (a.status !== "pending") return NextResponse.json({ error: "The office withdrew this agreement." }, { status: 400 });
  // The text must be exactly what was frozen when sent, AND exactly what this resident was shown.
  if (sha(String(a.body)) !== a.body_sha256 || String(b.bodySha256 || "") !== a.body_sha256) {
    return NextResponse.json({ error: "This addendum was updated by the office. Please close it, open it again, and read the current text before signing." }, { status: 409 });
  }
  if (!b.agree) return NextResponse.json({ error: "Check \"I have read and agree\" to sign." }, { status: 400 });
  const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name || norm(name) !== norm(r.full_name)) {
    return NextResponse.json({ error: `Type your full name exactly as it is on file: ${r.full_name}` }, { status: 400 });
  }
  const sig = typeof b.signature === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature) && b.signature.length < 400_000 ? b.signature : null;
  const sigStyle = sig ? (b.signature_style === "drawn" ? "drawn by hand" : `adopted in the "${String(b.signature_style || "script").replace(/[^A-Za-z ]/g, "").slice(0, 40)}" style`) : null;
  const signedAt = new Date();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const agent = (req.headers.get("user-agent") || "").slice(0, 300);

  // Claim it first (status + hash in the WHERE) so two clicks — or an office resend that changed
  // the text a second ago — can't produce a signature on the wrong text.
  const { data: claimed } = await supabase.from("resident_lease_addenda").update({
    status: "signed", signed_at: signedAt.toISOString(), signer_name: name, signer_email: r.email, signer_ip: ip, signer_ua: agent,
    signature_image: sig, signature_style: sigStyle, viewed_at: a.viewed_at || signedAt.toISOString(), updated_at: signedAt.toISOString(),
  }).eq("id", a.id).eq("status", "pending").eq("body_sha256", a.body_sha256).select("id").maybeSingle();
  if (!claimed) return NextResponse.json({ error: "This addendum was already signed or changed. Please reload the page." }, { status: 409 });
  // Freeze the park's signature as it is right now (blank if no manager has one yet — never MelyOS's).
  const signer = await parkSigner(r.company_id);
  a.sent_by_name = signer?.name || null; a.sent_by_title = signer?.title || null; a.sent_by_signature = signer?.signature || null;
  await supabase.from("resident_lease_addenda").update({ sent_by_name: a.sent_by_name, sent_by_title: a.sent_by_title, sent_by_signature: a.sent_by_signature }).eq("id", a.id);

  const { data: co } = await supabase.from("companies").select("company_name, dba_name, legal_name, address, city, state, zip_code, domain").eq("id", r.company_id).maybeSingle();
  const c: any = co || {};
  const parkName = String(c.dba_name || c.company_name || "the Park");
  const landlordName = String(c.legal_name || parkName);
  const florida = /^(fl|florida)$/i.test(String(c.state || "").trim()) || /,\s*FL\b/i.test(String(c.address || ""));

  // Signed PDF → private bucket → the resident's Documents. The signature itself is already recorded,
  // so a PDF problem never undoes it (the office can still see the signed text and metadata).
  let pdfOk = false;
  try {
    const bytes = await buildSignedContractPdf({
      marinaName: landlordName, marinaAddress: [c.address, c.city, [c.state, c.zip_code].filter(Boolean).join(" ")].filter(Boolean).join(", "), domain: String(c.domain || ""),
      contractId: a.id, title: a.title, body: a.body, bodyHash: a.body_sha256,
      signerName: name, signerEmail: r.email || "", signedAt, ip, userAgent: agent, signatureImage: sig, signatureStyle: sigStyle,
      sentAt: a.sent_at, sentByName: a.sent_by_name, sentBySignature: a.sent_by_signature || null, sentByTitle: a.sent_by_title || null,
      viewedAt: a.viewed_at || signedAt.toISOString(),
      labels: {
        signer: "RESIDENT", company: "PARK", docRef: "Agreement No.", idLabel: "Agreement ID",
        method: `Signer was signed in to their resident portal at ${c.domain || "the park's website"} with their own login, opened the agreement, checked "I have read and agree to this Resident Agreement, and I adopt this signature and agree to sign electronically", and typed their full name${sig ? `; signature image ${sigStyle || "captured"}` : ""}.`,
        legal: `Under the federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.)${florida ? " and the Florida Uniform Electronic Transaction Act (§ 668.50, Fla. Stat.)" : " and applicable state law"}, this electronic signature has the same legal effect as a handwritten signature. The document fingerprint above is computed from the exact addendum text; any change to a single character produces a different fingerprint.`,
      },
    });
    const day = signedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const path = `${r.company_id}/lease-addenda/${a.id}.pdf`;
    const up = await supabase.storage.from("resident-documents").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (up.error) throw up.error;
    const { data: doc } = await supabase.from("resident_documents").insert({
      company_id: r.company_id, resident_id: r.id,
      file_name: `${String(a.title).replace(/[^\w\s.—-]+/g, "").trim() || "Resident Agreement"} (signed ${day})`,
      file_url: path, document_type: "lease_addendum", uploaded_at: signedAt.toISOString(),
    }).select("id").maybeSingle();
    await supabase.from("resident_lease_addenda").update({ pdf_path: path, document_id: doc?.id || null }).eq("id", a.id);
    pdfOk = true;
  } catch (e: any) {
    console.error("lease addendum pdf failed:", e?.message);
  }

  // Tell the office (admin bell).
  await supabase.from("resident_update_notifications").insert({
    company_id: r.company_id, resident_id: r.id, resident_name: r.full_name, update_type: "lease_addendum_signed",
    message: `${r.full_name}${a.lot_name ? ` (Lot ${a.lot_name})` : ""} signed "${a.title}".${pdfOk ? " The signed copy is in their Documents." : " (The signed PDF could not be created — the signature is recorded in Lease Addenda.)"}`,
  }).then(() => null, () => null);

  return NextResponse.json({ ok: true, hasPdf: pdfOk, message: `Signed. Thank you! ${parkName} has your signature${pdfOk ? ", and your signed copy is in Documents" : ""}.` });
}
