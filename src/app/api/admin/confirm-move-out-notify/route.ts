import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMoveOutConfirmedEmail } from "@/lib/send-move-out-confirmed-email";

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
    .select("full_name, email, company_id")
    .eq("id", residentId)
    .maybeSingle();

  if (residentError || !resident || !resident.email) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404, headers: CORS_HEADERS });
  }

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("company_name")
    .eq("id", resident.company_id)
    .maybeSingle();

  try {
    await sendMoveOutConfirmedEmail({
      toEmail: resident.email,
      residentName: resident.full_name,
      companyName: company?.company_name || "the office",
      moveOutDate,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not send email." }, { status: 500, headers: CORS_HEADERS });
  }

  return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
}
