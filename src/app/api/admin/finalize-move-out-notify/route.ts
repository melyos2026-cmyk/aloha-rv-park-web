import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMoveOutFinalizedEmail } from "@/lib/send-move-out-finalized-email";
import { generateMoveOutConfirmationPdf } from "@/lib/generate-move-out-confirmation-pdf";
import {
  adminCorsHeaders,
  adminSessionSecretConfigured,
  rejectForeignOrigin,
  requireAdminSessionForCompany,
} from "@/lib/adminNotifyAuth";

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: adminCorsHeaders(req) });
}

// POST body: { residentId, moveOutDate, notes, owingAmount }  (+ header x-admin-session)
// Aug 6 (per Mely): the FINALIZE step (permanent lease closure) never told
// the resident anything — separate from the earlier "date confirmed" email.
//
// Oct 20 (security review): CORS was "*" and there was no auth — anyone
// could email any resident a "finalized move-out" PDF with a made-up
// balance and made-up notes. Now:
//  - CORS limited to the two admin origins;
//  - when ADMIN_SESSION_SECRET is set on this site, a valid admin session
//    (x-admin-session) for the resident's company is REQUIRED;
//  - always: the resident must have an Ended lease whose lease_end is
//    exactly moveOutDate (both finalize callers set that right before
//    calling here);
//  - the balance owed is ALWAYS computed here from the DB (same formula as
//    melyos-builder's unpaid_total: unpaid invoices + remaining payment-
//    plan installments) — the body's owingAmount is ignored;
//  - the admin's free-text notes are only included when the request has a
//    valid admin session (they can't be verified otherwise).
export async function POST(req: NextRequest) {
  const CORS_HEADERS = adminCorsHeaders(req);
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  const { residentId, moveOutDate, notes: bodyNotes } = await req.json();

  if (!residentId || !moveOutDate) {
    return NextResponse.json(
      { error: "residentId and moveOutDate are required." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const { data: resident, error: residentError } = await supabaseAdmin
    .from("resident_accounts")
    .select("full_name, email, company_id, space_id")
    .eq("id", residentId)
    .maybeSingle();

  if (residentError || !resident || !resident.email) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404, headers: CORS_HEADERS });
  }

  // Oct 20 (security review): see comment above.
  let adminVerified = false;
  // Oct 26 (security review): fail closed — without ADMIN_SESSION_SECRET no admin session can be
  // checked, so the request is refused instead of skipping the check.
  if (!adminSessionSecretConfigured()) {
    return NextResponse.json({ error: "Admin sign-in is not configured on this site." }, { status: 503, headers: CORS_HEADERS });
  }
  {
    const denied = requireAdminSessionForCompany(req, resident.company_id);
    if (denied) return denied;
  }
  adminVerified = true;
  const { data: leases } = await supabaseAdmin
    .from("resident_leases")
    .select("id, status, lease_end")
    .eq("resident_id", residentId);
  const hasFinalizedMoveOut = (leases || []).some(
    (l: any) =>
      l.status === "Ended" &&
      l.lease_end &&
      String(l.lease_end).slice(0, 10) === String(moveOutDate).slice(0, 10)
  );
  if (!hasFinalizedMoveOut) {
    return NextResponse.json(
      { error: "No finalized move-out found for this resident and date." },
      { status: 409, headers: CORS_HEADERS }
    );
  }
  const notes = adminVerified && typeof bodyNotes === "string" ? bodyNotes.slice(0, 2000) : null;

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("company_name, address, logo_url")
    .eq("id", resident.company_id)
    .maybeSingle();

  let lotName: string | null = null;
  if (resident.space_id) {
    const { data: lot } = await supabaseAdmin
      .from("rv_lots")
      .select("lot_name")
      .eq("id", resident.space_id)
      .maybeSingle();
    lotName = lot?.lot_name || null;
  }

  // Oct 20 (security review): computed from the DB, never from the request.
  const { data: unpaidInvoices } = await supabaseAdmin
    .from("resident_invoices")
    .select("total_amount")
    .eq("resident_id", residentId)
    .neq("status", "Paid");
  const { data: plans } = await supabaseAdmin
    .from("recurring_charges")
    .select("amount, total_installments, installments_charged")
    .eq("resident_id", residentId)
    .not("total_installments", "is", null);
  const remainingPlanBalance = (plans || []).reduce((sum: number, p: any) => {
    const left = Math.max(0, (p.total_installments || 0) - (p.installments_charged || 0));
    return sum + left * Number(p.amount || 0);
  }, 0);
  const finalOwingAmount =
    (unpaidInvoices || []).reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0) +
    remainingPlanBalance;

  let pdfBuffer: Buffer | undefined;
  try {
    pdfBuffer = await generateMoveOutConfirmationPdf({
      companyName: company?.company_name || "the office",
      companyAddress: company?.address || null,
      companyLogoUrl: company?.logo_url || null,
      residentName: resident.full_name,
      lotName,
      moveOutDate,
      goodStanding: finalOwingAmount <= 0,
      owingAmount: finalOwingAmount,
      finalized: true,
      notes: notes || null,
    });
  } catch (err) {
    console.error("Could not generate move-out finalized PDF:", err);
  }

  try {
    await sendMoveOutFinalizedEmail({
      toEmail: resident.email,
      residentName: resident.full_name,
      companyName: company?.company_name || "the office",
      moveOutDate,
      goodStanding: finalOwingAmount <= 0,
      owingAmount: finalOwingAmount,
      pdfBuffer,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not send email." }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
}
