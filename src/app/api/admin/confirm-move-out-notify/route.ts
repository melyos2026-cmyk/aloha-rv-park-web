import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMoveOutConfirmedEmail } from "@/lib/send-move-out-confirmed-email";
import { generateMoveOutConfirmationPdf } from "@/lib/generate-move-out-confirmation-pdf";

// Aug 6 (per Mely: "cómo el residente sabe que fue aprobado?"): called
// cross-domain from admin.aloharvparkfl.com right after admin confirms a
// move-out date — same CORS pattern as send-payment-reminder, since a
// browser silently blocks the response without these headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

// POST body: { residentId, moveOutDate }
export async function POST(req: NextRequest) {
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
