import { NextRequest, NextResponse } from "next/server";
import { hasViewAsCookie, isSafeMethod, VIEW_AS_ALLOWED_WRITES, VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/viewAsCookie";

// Two jobs:
//
// 1) Pre-launch password (restored Oct 29, per Mely — Aloha's site stays private until mid-November).
//    This used to live in the root middleware.ts; it moved here when src/proxy.ts was added.
//    Uses SITE_PASSWORD_USER / SITE_PASSWORD from Vercel. When both are unset the gate is OFF
//    (never a built-in password). The demo sites stay public. API routes, Next assets and the
//    privacy / terms / text-messages pages are not gated (webhooks, SMS consent review).
//    To open the site to residents: delete those two variables in Vercel and redeploy.
//
// 2) "View as resident" (read only): a browser holding the view-as cookie (src/lib/residentViewAs.ts)
//    can't make ANY non-GET API request — payments, checkout, autopay, signatures, profile edits,
//    uploads, messages, SMS, chat, applications — except leaving the mode. lib/portalSession.ts
//    refuses the same requests again. GET /api/verify-payment-session is refused too (it calls Stripe).
const SITE_USER = process.env.SITE_PASSWORD_USER || "";
const SITE_PASS = process.env.SITE_PASSWORD || "";
const PUBLIC_HOSTS = new Set(["marinademo.melyos.io", "tohodemo.melyos.io", "demo.melyos.io"]);
const UNGATED_PAGES = new Set(["/privacy", "/terms", "/text-messages", "/favicon.ico"]);

function sitePasswordOk(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("basic ")) return false;
  let decoded = "";
  try { decoded = atob(auth.slice(6).trim()); } catch { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  return decoded.slice(0, i) === SITE_USER && decoded.slice(i + 1) === SITE_PASS;
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/\/+$/, "") || "/";

  if (!path.startsWith("/api/") && path !== "/api") {
    if (!SITE_USER || !SITE_PASS) return NextResponse.next();
    const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
    if (PUBLIC_HOSTS.has(host) || UNGATED_PAGES.has(path)) return NextResponse.next();
    if (sitePasswordOk(req)) return NextResponse.next();
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Aloha RV Park"', "Cache-Control": "no-store" },
    });
  }

  if (!hasViewAsCookie(req.headers.get("cookie"))) return NextResponse.next();
  const blockedRead = path === "/api/verify-payment-session";
  if (isSafeMethod(req.method) && !blockedRead) return NextResponse.next();
  if (!blockedRead && VIEW_AS_ALLOWED_WRITES.has(path)) return NextResponse.next();
  return NextResponse.json(
    { error: VIEW_AS_READ_ONLY_MESSAGE, viewAs: true },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image).*)"],
};
