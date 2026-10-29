import { NextResponse } from "next/server";
import { clearPortalSessionCookie } from "@/lib/portalSession";
import { clearViewAsCookie, endViewAsSession, getViewAsSession } from "@/lib/residentViewAs";

// POST /api/portal-logout — clears the signed portal session cookie set at
// login. The frontend also clears its localStorage resident_id/name (that
// part still works as before); this just makes sure the real auth cookie
// goes away too so a stale session can't be reused after logout.
export async function POST(req: Request) {
  // Oct 29 ("View as resident"): signing out also leaves read-only view mode.
  const viewAs = await getViewAsSession(req);
  if (viewAs) await endViewAsSession(viewAs.id);
  const res = NextResponse.json({ success: true });
  clearPortalSessionCookie(res);
  clearViewAsCookie(res);
  return res;
}
