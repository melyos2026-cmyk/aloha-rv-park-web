import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMoveOutConfirmedEmail } from "@/lib/send-move-out-confirmed-email";
import { generateMoveOutConfirmationPdf } from "@/lib/generate-move-out-confirmation-pdf";
import {
  adminCorsHeaders,
  adminSessionSecretConfigured,
  rejectForeignOrigin,
  requireAdminSessionForCompany,
} from "@/lib/adminNotifyAuth";

// Aug 6 (per Mely: "cómo el residente sabe que fue aprobado?"): called
// cross-domain from admin.aloharvparkfl.com right after admin confirms a
// move-out date — same CORS pattern as send-payment-reminder, since a
// browser silently blocks the response without these headers.
// Oct 20 (security review): CORS was "*" and there was no auth — anyone
// could make the park email any resident a move-out confirmation PDF.
// CORS is now limited to the two admin origins, and the request must carry
// a valid admin session (x-admin-session) when ADMIN_SESSION_SECRET is set
// on this site; until then, it must match a REAL confirmed move-out in the
// DB (a lease for this resident whose lease_end is exactly moveOutDate —
// which melyos-builder's confirm-move-out sets right before calling here).
export async function OPTIONS(req: NextRequest) {
  return NextResponse.json({}, { headers: adminCorsHeaders(req) });
}

// POST body: { residentId, moveOutDate }  (+ header x-admin-session)
export async function POST(req: NextRequest) {
  const CORS_HEADERS = adminCorsHeaders(req);
  const foreign = rejectForeignOrigin(req);
  if (foreign) return foreign;

  const { residentId, moveOutDate } = await req.json();

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
  // Oct 26 (security review): fail closed — without ADMIN_SESSION_SECRET no admin session can be
  // checked, so the request is refused instead of skipping the check.
  if (!adminSessionSecretConfigured()) {
    return NextResponse.json({ error: "Admin sign-in is not configured on this site." }, { status: 503, headers: CORS_HEADERS });
  }
  {
    const denied = await requireAdminSessionForCompany(req, resident.company_id);
    if (denied) return denied;
  }
  const { data: leases } = await supabaseAdmin
    .from("resident_leases")
    .select("id, lease_end")
    .eq("resident_id", residentId);
  const hasConfirmedMoveOut = (leases || []).some(
    (l: any) => l.lease_end && String(l.lease_end).slice(0, 10) === String(moveOutDate).slice(0, 10)
  );
  if (!hasConfirmedMoveOut) {
    return NextResponse.json(
      { error: "No confirmed move-out found for this resident and date." },
      { status: 409, headers: CORS_HEADERS }
    );
  }

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

  // Aug 6 (per Mely: PDF similar to the existing Move-Out/Cancellation
  // Statement, showing good-standing vs owing) — same balance-check logic,
  // generated here (server-side, pdf-lib) so it can be emailed.
  const { data: unpaidInvoices } = await supabaseAdmin
    .from("resident_invoices")
    .select("total_amount")
    .eq("resident_id", residentId)
    .neq("status", "Paid");

  const owingAmount = (unpaidInvoices || []).reduce(
    (sum, inv) => sum + Number(inv.total_amount || 0),
    0
  );

  let pdfBuffer: Buffer | undefined;
  try {
    pdfBuffer = await generateMoveOutConfirmationPdf({
      companyName: company?.company_name || "the office",
      companyAddress: company?.address || null,
      companyLogoUrl: company?.logo_url || null,
      residentName: resident.full_name,
      lotName,
      moveOutDate,
      goodStanding: owingAmount <= 0,
      owingAmount,
    });
  } catch (err) {
    console.error("Could not generate move-out confirmation PDF:", err);
  }

  try {
    await sendMoveOutConfirmedEmail({
      toEmail: resident.email,
      residentName: resident.full_name,
      companyName: company?.company_name || "the office",
      moveOutDate,
      pdfBuffer,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not send email." }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
}
