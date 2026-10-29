import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { PORTAL_INFO_KEY, afterHoursSentence, defaultPortalInfo, normalizePortalInfo, parkRulesFrom } from "@/lib/portalInfo";

// Oct 28 (per Mely): "Park info" in the resident portal — office hours, emergency phone, what to do in
// an emergency (call 911 first / call the park's emergency line), the after-hours fee note and the
// park rules. Edited in the admin under Park setup → Resident Portal Info (melyos-builder).
// Sources (one each): lease_defaults.portal_info (hours + emergencies), lease_defaults.park_rules
// (the same rules applicants agree to), companies.emergency_phone / contact_phone / phone, and
// company_fee_settings (after-hours fee). Scoped to the signed-in resident's own company.
// GET /api/portal/park-info?residentId=...
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident, error: rErr } = await supabase
    .from("resident_accounts").select("company_id").eq("id", residentId).maybeSingle();
  if (rErr || !resident?.company_id) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const cid = resident.company_id;

  const [{ data: co }, { data: ps }, { data: fees }] = await Promise.all([
    supabase.from("companies").select("company_name, park_id, phone, contact_phone, emergency_phone").eq("id", cid).maybeSingle(),
    supabase.from("park_settings").select("lease_defaults").eq("company_id", cid).maybeSingle(),
    supabase.from("company_fee_settings").select("after_hours_fee, charge_after_hours").eq("company_id", cid).maybeSingle(),
  ]);
  const c: any = co || {};
  const ld: any = (ps as any)?.lease_defaults || {};
  const saved = ld?.[PORTAL_INFO_KEY];
  const info = saved ? normalizePortalInfo(saved, c.park_id) : defaultPortalInfo(c.park_id);
  const officePhone = c.contact_phone || c.phone || "";

  return NextResponse.json({
    parkName: c.company_name || "",
    // Not saved yet → the suggested emergency instructions show, office hours are hidden.
    configured: !!saved,
    hoursMode: info.hours_mode,
    hours: info.hours,
    hoursText: info.hours_text,
    hoursNote: info.hours_note,
    emergencies: info.emergencies,
    officePhone,
    emergencyPhone: c.emergency_phone || officePhone,
    emergencyIsOffice: !c.emergency_phone,
    // Same defaults the admin Fee Settings shows when nothing was saved yet ($25, on).
    afterHours: afterHoursSentence(fees ? fees.charge_after_hours !== false : true, Number(fees?.after_hours_fee ?? 25)),
    parkRules: parkRulesFrom(ld),
  }, { headers: { "Cache-Control": "no-store" } });
}
