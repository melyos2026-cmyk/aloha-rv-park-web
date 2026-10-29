import { NextRequest, NextResponse } from "next/server";
import { clearViewAsCookie, endViewAsSession, getViewAsSession } from "@/lib/residentViewAs";

// Oct 29 (per Mely — "View as resident"): POST /api/portal/view-as/exit — leaves read-only view
// mode: the view session is marked ended (it can't be used again) and the cookie is cleared.
// The only write a view-as browser may make (allow-listed in src/proxy.ts).
export async function POST(req: NextRequest) {
  const v = await getViewAsSession(req);
  if (v) await endViewAsSession(v.id);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearViewAsCookie(res);
  return res;
}
