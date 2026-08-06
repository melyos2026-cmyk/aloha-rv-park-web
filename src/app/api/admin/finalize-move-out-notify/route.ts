import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMoveOutFinalizedEmail } from "@/lib/send-move-out-finalized-email";
import { generateMoveOutConfirmationPdf } from "@/lib/generate-move-out-confirmation-pdf";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

// POST body: { residentId, moveOutDate, notes, owingAmount }
// Aug 6 (per Mely): the FINALIZE step (permanent lease closure) never told
// the resident anything — separate from the earlier "date confirmed" email.
export async function POST(req: NextRequest) {
  const { residentId, moveOutDate, notes, owingAmount } = await req.json();

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

  const finalOwingAmount = Number(owingAmount || 0);

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
