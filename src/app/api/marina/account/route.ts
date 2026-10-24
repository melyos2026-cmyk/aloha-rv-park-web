import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { loadAccount } from "@/lib/marina/data";
import { isDemoDomain } from "@/lib/marina/host";
import { rentalsEnabled } from "@/lib/rentals";
import { moduleOn } from "@/lib/concierge";
import { loadRestaurant } from "@/lib/restaurant";

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

  return NextResponse.json({ ...account, demo: isDemoDomain(company.domain), companyName: company.company_name, rentals: await rentalsEnabled(company.id), concierge: await moduleOn(company.id, "concierge"), restaurant: await moduleOn(company.id, "restaurant") ? (await loadRestaurant(company.id, company.company_name)).name : null });
}
