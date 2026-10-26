// Oct 19 (per Mely — Twilio A2P 10DLC): resident turns text-message alerts
// on (explicit checkbox) or off from the portal.
// GET  ?residentId=...           → { phone, enabled }
// POST { residentId, enabled }   → records consent (with wording, date, IP)
//                                   or revokes it. Notifies the office.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { hasSmsConsent, recordSmsConsentAndConfirm as recordSmsConsent, revokeSmsConsent, requestIp, normalizeSmsPhone } from "@/lib/smsConsent";

async function loadResident(residentId: string) {
  const { data } = await supabase
    .from("resident_accounts")
    .select("id, full_name, phone, company_id, companies(company_name)")
    .eq("id", residentId)
    .maybeSingle();
  return data as any;
}

export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  const r = await loadResident(residentId!);
  if (!r) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const enabled = await hasSmsConsent(r.company_id, r.phone);
  return NextResponse.json({ phone: r.phone || null, enabled });
}

export async function POST(req: NextRequest) {
  const { residentId, enabled } = await req.json().catch(() => ({}));
  const authError = await requireMatchingSession(req, residentId || null);
  if (authError) return authError;
  const r = await loadResident(residentId);
  if (!r) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  if (!normalizeSmsPhone(r.phone)) {
    return NextResponse.json({ error: "Add a valid mobile number to your Resident Information first." }, { status: 400 });
  }

  if (enabled === true) {
    const result = await recordSmsConsent({
      companyId: r.company_id,
      phone: r.phone,
      name: r.full_name,
      source: "portal",
      parkName: r.companies?.company_name || "our park",
      ip: requestIp(req),
      residentId: r.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  } else {
    await revokeSmsConsent(r.company_id, r.phone);
  }

  // Mely's rule: any change the resident makes notifies the office.
  await supabase.from("resident_update_notifications").insert({
    company_id: r.company_id,
    resident_id: r.id,
    resident_name: r.full_name,
    update_type: "resident_info",
    message: `${r.full_name || "A resident"} turned text-message alerts ${enabled === true ? "ON" : "OFF"}.`,
  });

  return NextResponse.json({ ok: true, enabled: enabled === true });
}
