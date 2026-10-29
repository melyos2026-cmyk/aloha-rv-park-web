import { NextRequest, NextResponse } from "next/server";
import { companyIdForHost, exchangeViewAsToken, setViewAsCookie } from "@/lib/residentViewAs";
import { hostnameFromRequest } from "@/lib/marina/host";

// Oct 29 (per Mely — "View as resident"): GET /residents/view-as?t=<one-time token>
// Opened in a new tab by the admin (melyos-builder → Resident Accounts → "View as resident").
// Exchanges the token ONCE for the read-only `resident_view_as` cookie (lib/residentViewAs.ts) and
// sends the browser to /residents/view-as/ready, which opens the dashboard. The token can't be
// reused (single use, 5-minute window) and the cookie ends with the view (30 minutes).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const hostCompanyId = await companyIdForHost(hostnameFromRequest(req)).catch(() => null);

  const result = await exchangeViewAsToken(token, ip, hostCompanyId);
  const ready = new URL("/residents/view-as/ready", req.url);
  if (!result.ok) {
    ready.searchParams.set("error", result.error);
    return NextResponse.redirect(ready, { status: 303, headers: NO_STORE });
  }
  const res = NextResponse.redirect(ready, { status: 303, headers: NO_STORE });
  setViewAsCookie(res, result.cookieSecret, result.session.expiresAt);
  return res;
}
