import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { adminCorsHeaders, rejectForeignOrigin, verifyAdminSessionLive } from "@/lib/adminNotifyAuth";
import { getMarinaById } from "@/lib/marina/company";
import { finalizeSignedContract } from "@/lib/marina/contractFinalize";

// POST /api/admin/marina-contract-countersign — Oct 27 (per Mely): the marina's second signature
// (e.g. a director), after the boater signed. Called by the office app with the manager's own
// session. Then the contract is complete: invoices, confirmation and the signed PDF (both marina
// signatures) — the same steps a contract without a second signature runs when the boater signs.
export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: adminCorsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = adminCorsHeaders(req);
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;
  const session = await verifyAdminSessionLive(req.headers.get("x-admin-session"));
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers });
  const b = await req.json().catch(() => ({}));
  const companyId = String(b.companyId || ""), contractId = String(b.contractId || "");
  if (session.role !== "master_admin" && session.companyId !== companyId) return NextResponse.json({ error: "Not authorized for this company." }, { status: 403, headers });

  const { data: me } = await supabaseAdmin.from("admin_users").select("*").eq("id", session.adminId).maybeSingle();
  if (!me || (me.role !== "master_admin" && me.company_id !== companyId)) return NextResponse.json({ error: "Please sign in again." }, { status: 401, headers });
  if (me.role !== "master_admin" && me.can_manage_money !== true) return NextResponse.json({ error: "Only a manager can sign for the marina." }, { status: 403, headers });
  if (!me.signature_image) return NextResponse.json({ error: "Save your signature first (My account & signature)." }, { status: 409, headers });

  const { data: k } = await supabaseAdmin.from("marina_contracts").select("*").eq("id", contractId).eq("company_id", companyId).maybeSingle();
  if (!k) return NextResponse.json({ error: "Contract not found." }, { status: 404, headers });
  if (!k.countersign_required || k.status !== "signed") return NextResponse.json({ error: "This contract isn't waiting for the marina's signature." }, { status: 409, headers });
  if (k.countersigned_at) return NextResponse.json({ error: "Already signed for the marina." }, { status: 409, headers });
  if (k.countersigner_id && k.countersigner_id !== me.id) return NextResponse.json({ error: "This contract is set to be signed by another manager." }, { status: 403, headers });

  const company = await getMarinaById(companyId);
  if (!company) return NextResponse.json({ error: "Marina not found." }, { status: 404, headers });
  const now = new Date().toISOString();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const { data: claimed } = await supabaseAdmin.from("marina_contracts").update({
    countersigned_at: now, countersigned_by_name: me.full_name || me.email, countersign_signature: me.signature_image,
    countersign_title: k.countersign_title || me.signature_title || null, countersign_ip: ip,
  }).eq("id", k.id).eq("company_id", companyId).is("countersigned_at", null).select("*").maybeSingle();
  if (!claimed) return NextResponse.json({ error: "Already signed for the marina." }, { status: 409, headers });

  const { data: member } = await supabaseAdmin.from("marina_members").select("full_name, email").eq("id", k.member_id).eq("company_id", companyId).maybeSingle();
  await finalizeSignedContract({
    company, memberId: k.member_id, member: { full_name: member?.full_name || k.signer_name || "", email: member?.email || k.signer_email || null }, k: claimed,
    name: k.signer_name, signedAt: new Date(k.signed_at), ip: k.signer_ip || "", agent: k.signer_agent || "", sig: k.signature_image || null, sigStyle: k.signature_style || null,
  });
  await supabaseAdmin.from("marina_messages").insert({ company_id: companyId, member_id: k.member_id, direction: "office", sent_by_name: me.full_name || "Marina office", subject: "Your contract is complete", body: `"${k.title}" is now signed by the marina too. Your copy is in your boater account (Contracts), and your invoices are ready.` }).then(() => null, () => null);
  return NextResponse.json({ ok: true }, { headers });
}
