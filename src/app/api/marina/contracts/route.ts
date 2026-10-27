import { isDemoCompany } from "@/lib/marina/host";
import { giveNotice } from "@/lib/marina/contractNotice";
import { mailOffice } from "@/lib/marina/slipAuto";
import { escHtml } from "@/lib/marina/contractCore";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { finalizeSignedContract } from "@/lib/marina/contractFinalize";

// Oct 21 (per Mely): a boater's contracts (sent from the marina admin) and
// electronic signing. Only the signed-in boater's own contracts, only on this
// marina's own domain.

const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const session = await getMarinaSession(req);
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
  const sel = (cols: string) => supabaseAdmin.from("marina_contracts").select(cols)
    .eq("company_id", w.company.id).eq("member_id", w.memberId).neq("status", "cancelled")
    .order("sent_at", { ascending: false }).limit(30);
  // Oct 27: the marina signer's adopted signature + title (columns from SQL 85; older databases without)
  let { data, error } = await sel("id, title, body, status, sent_at, sent_by_name, sent_by_signature, sent_by_title, countersign_required, countersigned_at, countersigned_by_name, countersign_title, countersign_signature, viewed_at, signed_at, signer_name, start_date, end_date, pdf_path") as any;
  if (error && /sent_by_signature|sent_by_title|countersign/.test(error.message)) ({ data, error } = await sel("id, title, body, status, sent_at, sent_by_name, viewed_at, signed_at, signer_name, start_date, end_date, pdf_path") as any);
  if (error) return NextResponse.json({ contracts: [] }); // tables not created yet on this database
  // Oct 27: month-to-month fields (SQL 91), read apart so an older database still works
  const { data: mt } = await supabaseAdmin.from("marina_contracts").select("id, month_to_month, notice_days, notice_given_at, ends_on").eq("company_id", w.company.id).eq("member_id", w.memberId).then((x) => x, () => ({ data: null } as any));
  const byId = new Map((mt || []).map((x: any) => [x.id, x]));
  return NextResponse.json({ contracts: (data || []).map((k: any) => ({ ...k, ...(byId.get(k.id) || {}), hasPdf: !!k.pdf_path, pdf_path: undefined })) });
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

  // Oct 27 (per Mely): the boater gives written notice to end a month-to-month agreement.
  if (b.action === "give_notice") {
    if (isDemoCompany(w.company)) return NextResponse.json({ error: "Not available in the demo." }, { status: 403 });
    const { data: me } = await supabaseAdmin.from("marina_members").select("full_name").eq("id", w.memberId).eq("company_id", w.company.id).maybeSingle();
    const r = await giveNotice(w.company.id, k, `${me?.full_name || "Boat owner"} (boater)`);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: w.company.id, resident_name: me?.full_name || "Boat owner", update_type: "contract", message: `${me?.full_name || "A boater"} gave notice on "${k.title}". Last day: ${r.endsOn}.` }).then(() => null, () => null);
    await mailOffice(w.company, `Notice to leave: ${me?.full_name || "a boater"} — last day ${r.endsOn}`, [`<b>${escHtml(me?.full_name || "A boater")}</b> gave written notice on <b>${escHtml(k.title)}</b>. The last day is <b>${escHtml(r.endsOn!)}</b>. No more monthly invoices after that.`], undefined, "contracts").catch(() => null);
    return NextResponse.json({ ok: true, endsOn: r.endsOn });
  }

  if (b.action !== "sign") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (k.status === "signed") return NextResponse.json({ error: "This contract is already signed." }, { status: 400 });
  if (k.status === "cancelled") return NextResponse.json({ error: "The marina cancelled this contract." }, { status: 400 });
  if (sha(k.body) !== k.body_hash) return NextResponse.json({ error: "This contract can't be signed. Please contact the marina office." }, { status: 409 });

  // Oct 26 (per Mely): for a new slip (slip request), insurance and registration must be uploaded
  // before signing (the office reviews them while the boater signs and pays). Marina setting.
  {
    const { data: rq } = await supabaseAdmin.from("marina_slip_requests").select("id").eq("company_id", w.company.id).eq("contract_id", k.id).maybeSingle();
    if (rq) {
      const [st, ins] = await Promise.all([
        supabaseAdmin.from("marina_booking_settings").select("docs_before_sign").eq("company_id", w.company.id).maybeSingle(),
        supabaseAdmin.from("company_modules").select("enabled").eq("company_id", w.company.id).eq("module_name", "marina_require_insurance").maybeSingle(),
      ]);
      if (!st.error && st.data?.docs_before_sign !== false) {
        const need = [...(ins.data?.enabled === false ? [] : ["insurance"]), "registration"];
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const { data: docs } = await supabaseAdmin.from("marina_boat_documents").select("doc_type, status, expires_on, boat_id, request_id").eq("company_id", w.company.id)
          .or(`request_id.eq.${rq.id}${k.boat_id ? `,boat_id.eq.${k.boat_id}` : ""}`);
        const missing = need.filter((t) => !(docs || []).some((d: any) => d.doc_type === t && d.status !== "rejected" && (!d.expires_on || d.expires_on >= today)));
        if (missing.length) {
          const label = missing.map((t) => (t === "insurance" ? "insurance" : "registration")).join(" and ");
          return NextResponse.json({ error: `Before signing, upload your boat's ${label} in Documents (on this page). It takes a minute with your phone camera.`, needDocs: missing }, { status: 409 });
        }
      }
    }
  }

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

  // Oct 27: kept for the signed PDF if it's built later (second marina signature). Best effort.
  await supabaseAdmin.from("marina_contracts").update({ signature_style: sigStyle }).eq("id", k.id).then(() => null, () => null);

  // Oct 27 (per Mely): the marina requires a second signature (e.g. a director) — invoices,
  // confirmation and the signed PDF wait for it. The office is told.
  if ((k as any).countersign_required && !(k as any).countersigned_at) {
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: w.company.id, resident_name: member.full_name, update_type: "contract", message: `${member.full_name} signed "${k.title}". It needs the marina's second signature${(k as any).countersign_title ? ` (${(k as any).countersign_title})` : ""} in Contracts.` }).then(() => null, () => null);
    // Oct 27: email the person who signs second (always) + admins with "Contracts" on — not the office inbox.
    await mailOffice(w.company, `Needs your signature: ${member.full_name} signed "${k.title}"`, [
      `<b>${escHtml(member.full_name)}</b> signed <b>${escHtml(k.title)}</b>. It needs the marina's second signature${(k as any).countersign_title ? ` (${escHtml((k as any).countersign_title)})` : ""}.`,
      "Open Contracts → Sign for the marina. The invoices and the boater's copy go out after that.",
    ], undefined, "contracts", { office: false, alsoIds: (k as any).countersigner_id ? [(k as any).countersigner_id] : [] }).catch(() => null);
    return NextResponse.json({ ok: true, waitingCountersign: true, message: "Signed. Thank you! The marina adds its final signature next, and then you'll get your copy and your invoices." });
  }

  await finalizeSignedContract({ company: w.company, memberId: w.memberId, member: { full_name: member.full_name, email: member.email }, k, name, signedAt, ip, agent, sig, sigStyle });
  await mailOffice(w.company, `${member.full_name} signed "${k.title}"`, [`<b>${escHtml(member.full_name)}</b> signed <b>${escHtml(k.title)}</b>. The signed copy is in the boat's Documents.`], undefined, "contracts", { office: false }).catch(() => null);

  return NextResponse.json({ ok: true });
}
