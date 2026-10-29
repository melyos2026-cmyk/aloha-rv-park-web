import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// GET /api/get-enabled-modules?company_id=...
// Sep 26 (per Mely — "si los mantengo apagados no se vera en la pagina
// oficial del cliente?"): turning Propane/Marketplace off in the admin
// only ever hid the Dashboard tile — the public site's own nav link and
// pages were still hardcoded to always show, regardless. Public
// (no admin session needed — this is just a yes/no per module, nothing
// sensitive) so the website's own header/pages can hide themselves to
// match.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const { data } = await supabaseAdmin
    .from("company_modules")
    .select("module_name, enabled")
    .eq("company_id", companyId);

  const enabled: Record<string, boolean> = {};
  (data || []).forEach((row) => {
    enabled[row.module_name] = !!row.enabled;
  });

  // Oct 29 (per Mely): the admin's Rec Hall on/off (melyos-builder /api/admin/rv-events writes
  // park_settings.lease_defaults.clubhouse_enabled; missing = on) — the public /events page hides
  // its "Rec Hall" rental section when it's off. Same yes/no only, nothing else from the row.
  const { data: ps } = await supabaseAdmin
    .from("park_settings")
    .select("lease_defaults")
    .eq("company_id", companyId)
    .maybeSingle();
  const recHall = (ps?.lease_defaults as Record<string, unknown> | null)?.clubhouse_enabled !== false;

  return NextResponse.json({ enabled, recHall });
}
