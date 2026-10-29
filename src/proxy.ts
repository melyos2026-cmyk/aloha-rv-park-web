import { NextRequest, NextResponse } from "next/server";
import { hasViewAsCookie, isSafeMethod, VIEW_AS_ALLOWED_WRITES, VIEW_AS_READ_ONLY_MESSAGE } from "@/lib/viewAsCookie";

// Oct 29 (per Mely — "View as resident", read only): ONE gate in front of every /api route.
// A browser holding the view-as cookie (src/lib/residentViewAs.ts) can't make ANY non-GET API
// request — payments, checkout, autopay, signatures, profile edits, uploads, messages, SMS, chat,
// applications — except leaving the mode. lib/portalSession.ts refuses the same requests again,
// so the portal routes stay protected even if this file stopped running.
// GET /api/verify-payment-session is refused too (it calls Stripe).
//
// Nothing else is done here: requests without that cookie pass straight through. (The old root
// middleware.ts staging gate is NOT active — Next only runs a proxy/middleware next to src/app.)
export function proxy(req: NextRequest) {
  if (!hasViewAsCookie(req.headers.get("cookie"))) return NextResponse.next();
  const path = req.nextUrl.pathname.replace(/\/+$/, "");
  const blockedRead = path === "/api/verify-payment-session";
  if (isSafeMethod(req.method) && !blockedRead) return NextResponse.next();
  if (!blockedRead && VIEW_AS_ALLOWED_WRITES.has(path)) return NextResponse.next();
  return NextResponse.json(
    { error: VIEW_AS_READ_ONLY_MESSAGE, viewAs: true },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = {
  matcher: ["/api/:path*"],
};
