import { NextRequest, NextResponse } from "next/server";
import { clearViewAsCookie, getViewAsSession } from "@/lib/residentViewAs";
import { hasViewAsCookie } from "@/lib/viewAsCookie";

// Oct 29 (per Mely — "View as resident"): GET /api/portal/view-as → is this browser in read-only
// view mode? Used by the portal banner and /residents/view-as/ready. A cookie that is no longer
// valid (expired, the admin exited or signed out, lost permission) is cleared here.
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (!hasViewAsCookie(req.headers.get("cookie"))) return NextResponse.json({ active: false }, { headers });
  const v = await getViewAsSession(req);
  if (!v) {
    const res = NextResponse.json({ active: false, ended: true }, { headers });
    clearViewAsCookie(res);
    return res;
  }
  return NextResponse.json(
    { active: true, residentId: v.residentId, residentName: v.residentName, expiresAt: v.expiresAt },
    { headers }
  );
}
