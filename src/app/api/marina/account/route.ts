import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { loadAccount } from "@/lib/marina/data";
import { isDemoCompany } from "@/lib/marina/host";
import { rentalsEnabled } from "@/lib/rentals";
import { moduleOn } from "@/lib/concierge";
import { loadRestaurant } from "@/lib/restaurant";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 24: whether bank (ACH) payments are offered and from what balance.
async function achSettings(companyId: string) {
  const { data } = await supabaseAdmin.from("company_fee_settings").select("ach_enabled, ach_min_amount").eq("company_id", companyId).maybeSingle();
  return { enabled: data?.ach_enabled !== false, min: Number(data?.ach_min_amount ?? 100) };
}

// GET /api/marina/account — the signed-in boater's own account.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const session = getMarinaSession(req);
  // The cookie must belong to THIS marina's domain, never another company's.
  if (!session || session.companyId !== company.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const account = await loadAccount(company.id, session.memberId);
  if (!account) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  return NextResponse.json({ ...account, demo: isDemoCompany(company), companyName: company.company_name, rentals: await rentalsEnabled(company.id), concierge: await moduleOn(company.id, "concierge"), restaurant: await moduleOn(company.id, "restaurant") ? (await loadRestaurant(company.id, company.company_name)).name : null, ach: await achSettings(company.id) });
}
