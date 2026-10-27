import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { sniff } from "@/lib/marina/fileType";
import { loadTransientRules } from "@/lib/marina/booking";
import { readResidencyDoc, verifyResidency } from "@/lib/marina/residency";
import { mailOffice } from "@/lib/marina/slipAuto";
import { getMarinaSession } from "@/lib/marina/session";

// POST /api/marina/residency (form: full_name, email, nights, id, support1?, support2?)
// Oct 27 (per Mely): the guest proves they live in the marina's city/county to get the resident
// rate. The system reads the ID (and documents) and approves at once when everything matches;
// otherwise the office decides in Document Review. Returns { checkId, status, message }.
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `residency:${company.id}`, 8)) return NextResponse.json({ error: "Too many tries from this device. Please call the dock office." }, { status: 429 });
  // Oct 27 (review): small requests only (photos are shrunk in the browser), and a daily cap per marina
  if (Number(req.headers.get("content-length") || 0) > 4_400_000) return NextResponse.json({ error: "The photos are too large. Take them again or use smaller files." }, { status: 413 });
  const { count: today } = await supabaseAdmin.from("marina_residency_checks").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 86400000).toISOString()).then((x) => x, () => ({ count: 0 } as any));
  if ((today || 0) >= 60) return NextResponse.json({ error: "Too many checks today. Please call the dock office." }, { status: 429 });
  const rules = await loadTransientRules(company.id);
  if (!rules.residentPricing) return NextResponse.json({ error: "This marina doesn't have a resident rate." }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const fullName = String(form?.get("full_name") || "").replace(/[<>]/g, "").trim().slice(0, 120);
  const email = String(form?.get("email") || "").trim().toLowerCase().slice(0, 160);
  const nights = Math.max(1, Math.min(400, Math.floor(Number(form?.get("nights")) || 1)));
  if (fullName.length < 2) return NextResponse.json({ error: "Enter your full name first (the same as on your ID)." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter your email first." }, { status: 400 });
  const needSupport = rules.residentProof === "id_plus_2" && nights >= 7;
  const names = needSupport ? ["id", "support1", "support2"] : ["id"];
  const files: { buf: Buffer; type: string; ext: string }[] = [];
  for (const n of names) {
    const f = form?.get(n);
    if (!f || typeof f === "string") return NextResponse.json({ error: n === "id" ? "Take a photo of your ID (driver's license, state ID or vehicle registration)." : "Add the two documents with your name and address (lease, utility bill, deed or voter card)." }, { status: 400 });
    if (f.size > 10 * 1024 * 1024) return NextResponse.json({ error: "A file is too large (max 10 MB)." }, { status: 400 });
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP, HEIC) or a PDF." }, { status: 400 });
    if (kind.type === "application/pdf" && buf.length > 3 * 1024 * 1024) return NextResponse.json({ error: "That PDF is too large. Upload a photo of the page instead." }, { status: 400 });
    files.push({ buf, type: kind.type, ext: kind.ext });
  }

  const { data: row, error } = await supabaseAdmin.from("marina_residency_checks").insert({ company_id: company.id, email, full_name: fullName, status: "pending" }).select("id").single();
  if (error || !row) return NextResponse.json({ error: /marina_residency_checks/.test(error?.message || "") ? "Resident verification isn't set up yet. Please call the office." : "Could not save. Please try again." }, { status: 500 });
  const paths: { path: string; kind: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = `${company.id}/residency/${row.id}/${names[i]}.${files[i].ext}`;
    const up = await supabaseAdmin.storage.from("marina-documents").upload(path, files[i].buf, { contentType: files[i].type, upsert: true });
    if (!up.error) paths.push({ path, kind: names[i] });
  }
  const docs = await Promise.all(files.map((f) => readResidencyDoc(f.buf, f.type, rules.residentArea)));
  const r = verifyResidency(docs, { fullName, area: rules.residentArea, zips: rules.residentZips, needSupport });
  const now = new Date().toISOString();
  await supabaseAdmin.from("marina_residency_checks").update({
    status: r.decision, files: paths, ai: { checks: r.checks, docs: r.docs, at: now, nights, needSupport }, address: r.address, expires_on: r.expires_on,
    ...(r.decision !== "pending" ? { reviewed_by_name: "Automatic check", reviewed_at: now, review_note: r.decision === "rejected" ? r.message : null } : {}),
  }).eq("id", row.id).eq("company_id", company.id);

  if (r.decision === "approved") {
    // Oct 27 (review): only the SIGNED-IN boater who sent it (their email proven by the sign-in code) is
    // marked resident for future bookings — never an account just because an email was typed.
    const ses = await getMarinaSession(req);
    if (ses && ses.companyId === company.id) {
      const { data: m } = await supabaseAdmin.from("marina_members").select("id, email").eq("id", ses.memberId).eq("company_id", company.id).maybeSingle();
      if (m && String(m.email || "").toLowerCase() === email) await supabaseAdmin.from("marina_members").update({ is_resident: true }).eq("id", m.id).eq("company_id", company.id).then(() => null, () => null);
    }
  } else if (r.decision === "pending") {
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: fullName, update_type: "document", message: `${fullName} sent proof of residency for the resident rate. Check it in Document Review.` }).then(() => null, () => null);
    await mailOffice(company, `Proof of residency to check: ${fullName}`, [`<b>${fullName.replace(/[<>&"]/g, "")}</b> asked for the resident rate and sent their ID${needSupport ? " and two documents" : ""}. The system couldn't approve it by itself: ${r.checks.filter((c) => c.ok !== true).map((c) => `${c.label} — ${c.detail}`).join("; ").replace(/[<>&"]/g, "")}.`, "Open Document Review → Residency."], undefined, "documents").catch(() => null);
  }
  return NextResponse.json({ checkId: row.id, status: r.decision, message: r.message, needSupport });
}
