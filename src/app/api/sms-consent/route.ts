// Oct 19 (per Mely — Twilio A2P campaign): public SMS opt-in from the
// /text-messages page. Records the person's explicit consent (exact
// wording, date, IP). No login: this page must be reachable by the carrier's
// reviewer.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { recordSmsConsentAndConfirm as recordSmsConsent, requestIp, normalizeUsSmsPhone } from "@/lib/smsConsent";

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { companyId, name, phone, agreed } = body || {};
  if (!companyId || typeof companyId !== "string") {
    return NextResponse.json({ error: "Missing company." }, { status: 400 });
  }
  if (agreed !== true) {
    return NextResponse.json({ error: "Please check the box to agree to receive text messages." }, { status: 400 });
  }
  if (!String(name || "").trim()) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }

  // Oct 20 (security review): this public, no-login form only accepts US
  // mobile numbers (+1 and 10 digits).
  const usPhone = normalizeUsSmsPhone(String(phone || ""));
  if (!usPhone) {
    return NextResponse.json({ error: "Please enter a valid US mobile number (10 digits)." }, { status: 400 });
  }

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("id, company_name")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  const result = await recordSmsConsent({
    companyId: company.id,
    phone: usPhone,
    name: String(name).trim().slice(0, 120),
    source: "public_form",
    parkName: company.company_name || "our park",
    ip: requestIp(req),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
