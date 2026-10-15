import { NextResponse } from "next/server";
import { clearMarinaSession } from "@/lib/marina/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearMarinaSession(res);
  return res;
}
