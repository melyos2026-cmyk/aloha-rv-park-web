import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { buildSignedContractPdf } from "@/lib/marina/contractPdf";

// Oct 21 (per Mely): a boater's contracts (sent from the marina admin) and
// electronic signing. Only the signed-in boater's own contracts, only on this
// marina's own domain.

const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const session = getMarinaSession(req);
  if (!session || session.companyId !== company.id) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { company, memberId: session.memberId };
}

// GET → { contracts }   ·   GET ?pdf=<id> → { url } (5-minute link to the signed PDF)
export async function GET(req: Request) {
  const w = await who(req);
  if (w.error) return w.error;
  const url = new URL(req.url);
  const pdfOf = url.searchParams.get("pdf");
  if (pdfOf) {
    const { data: k } = await supabaseAdmin.from("marina_contracts").select("pdf_path")
      .eq("id", pdfOf).eq("company_id", w.company.id).eq("member_id", w.memberId).eq("status", "signed").maybeSingle();
    if (!k?.pdf_path) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { data: signed } = await supabaseAdmin.storage.from("marina-documents").createSignedUrl(k.pdf_path, 300);
    if (!signed) return NextResponse.json({ error: "Could not open the PDF." }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl });
  }
  const { data, error } = await supabaseAdmin.from("marina_contracts")
    .select("id, title, body, status, sent_at, sent_by_name, viewed_at, signed_at, signer_name, start_date, end_date, pdf_path")
    .eq("company_id", w.company.id).eq("member_id", w.memberId).neq("status", "cancelled")
    .order("sent_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ contracts: [] }); // tables not created yet on this database
  return NextResponse.json({ contracts: (data || []).map((k) => ({ ...k, hasPdf: !!k.pdf_path, pdf_path: undefined })) });
}

// POST { id, action: "view" }  |  { id, action: "sign", name, agree, signature? }
export async function POST(req: Request) {
  const w = await who(req);
  if (w.error) return w.error;
  let b: any = {};
  try { b = await req.json(); } catch {}
  const { data: k } = await supabaseAdmin.from("marina_contracts").select("*")
    .eq("id", String(b.id || "")).eq("company_id", w.company.id).eq("member_id", w.memberId).maybeSingle();
  if (!k) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  if (b.action === "view") {
    if (k.status === "sent") await supabaseAdmin.from("marina_contracts").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", k.id).eq("status", "sent");
    return NextResponse.json({ ok: true });
  }

  if (b.action !== "sign") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (k.status === "signed") return NextResponse.json({ error: "This contract is already signed." }, { status: 400 });
  if (k.status === "cancelled") return NextResponse.json({ error: "The marina cancelled this contract." }, { status: 400 });
  if (sha(k.body) !== k.body_hash) return NextResponse.json({ error: "This contract can't be signed. Please contact the marina office." }, { status: 409 });

  const { data: member } = await supabaseAdmin.from("marina_members").select("full_name, email").eq("id", w.memberId).eq("company_id", w.company.id).maybeSingle();
  if (!member) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!b.agree) return NextResponse.json({ error: "Check \"I adopt this signature and agree to sign electronically\" to sign." }, { status: 400 });
  if (!name || norm(name) !== norm(member.full_name)) {
    return NextResponse.json({ error: `Type your full name exactly as it is on file: ${member.full_name}` }, { status: 400 });
  }
  const sig = typeof b.signature === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.signature) && b.signature.length < 400_000 ? b.signature : null;

  const sigStyle = sig ? (b.signature_style === "drawn" ? "drawn by hand" : `adopted in the "${String(b.signature_style || "script").replace(/[^A-Za-z ]/g, "").slice(0, 40)}" style`) : null;
  const signedAt = new Date();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  const agent = (req.headers.get("user-agent") || "").slice(0, 300);

  // Claim it first so two clicks can't sign twice.
  const { data: claimed } = await supabaseAdmin.from("marina_contracts").update({
    status: "signed", signed_at: signedAt.toISOString(), signer_name: name, signer_email: member.email, signer_ip: ip, signer_agent: agent,
    signature_image: sig, viewed_at: k.viewed_at || signedAt.toISOString(),
  }).eq("id", k.id).in("status", ["sent", "viewed"]).select("id").maybeSingle();
  if (!claimed) return NextResponse.json({ error: "This contract is already signed." }, { status: 400 });

  // Signed PDF → private bucket → the boat's Documents.
  const company: any = w.company;
  try {
    const bytes = await buildSignedContractPdf({
      marinaName: company.company_name, marinaAddress: company.address || "", domain: company.domain,
      contractId: k.id, title: k.title, body: k.body, bodyHash: k.body_hash,
      signerName: name, signerEmail: member.email || "", signedAt, ip, userAgent: agent, signatureImage: sig, signatureStyle: sigStyle,
      sentAt: k.sent_at, sentByName: k.sent_by_name, viewedAt: k.viewed_at || signedAt.toISOString(),
    });
    const path = `${w.company.id}/contracts/${k.id}.pdf`;
    const up = await supabaseAdmin.storage.from("marina-documents").upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: true });
    if (up.error) throw up.error;
    let docId: string | null = null;
    if (k.boat_id) {
      const fileName = `${k.title.replace(/[^\w\s.-]+/g, "").trim() || "Contract"} - signed ${signedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" })}.pdf`;
      const { data: doc } = await supabaseAdmin.from("marina_boat_documents").insert({
        company_id: w.company.id, boat_id: k.boat_id, doc_type: "contract", file_name: fileName, file_path: path, expires_on: k.end_date || null,
      }).select("id").maybeSingle();
      docId = doc?.id || null;
    }
    await supabaseAdmin.from("marina_contracts").update({ pdf_path: path, document_id: docId }).eq("id", k.id);
  } catch (e: any) {
    // The signature itself is recorded; the office can still see it. Log the PDF problem.
    console.error("contract pdf failed:", e?.message);
  }

  return NextResponse.json({ ok: true });
}
