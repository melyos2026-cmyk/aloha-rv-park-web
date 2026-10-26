import { NextResponse } from "next/server";
import { logProspect } from "@/lib/demoProspects";

// POST /api/demo-visit — Oct 26 (per Mely): a prospect opened a page of the demo website with their
// personal link (?d=…). Only on the demo marina's address.
const DEMO_HOSTS = ["marinademo.melyos.io"];

export async function POST(req: Request) {
  const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
  if (!DEMO_HOSTS.includes(host)) return NextResponse.json({ ok: false }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  await logProspect(req, b.d, "site", String(b.path || "/"), b.s).catch(() => null);
  return NextResponse.json({ ok: true });
}
