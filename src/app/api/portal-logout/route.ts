import { NextResponse } from "next/server";
import { clearPortalSessionCookie } from "@/lib/portalSession";

// POST /api/portal-logout — clears the signed portal session cookie set at
// login. The frontend also clears its localStorage resident_id/name (that
// part still works as before); this just makes sure the real auth cookie
// goes away too so a stale session can't be reused after logout.
export async function POST() {
  const res = NextResponse.json({ success: true });
  clearPortalSessionCookie(res);
  return res;
}
