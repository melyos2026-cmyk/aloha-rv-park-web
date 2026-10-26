import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaById } from "@/lib/marina/company";
import { runMarinaAutopay, reconcileAutopay } from "@/lib/marina/autopay";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/marina-autopay — Oct 26 (per Mely — Group 2): every morning, charge each marina
// boater with autopay for what is due, and settle bank payments that cleared.
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settled = await reconcileAutopay().catch(() => 0);
  const { data, error } = await supabaseAdmin.from("marina_members").select("company_id").eq("autopay_enabled", true).limit(20000);
  if (error) return NextResponse.json({ settled, error: error.message });
  const out: Record<string, any> = {};
  for (const cid of [...new Set((data || []).map((m: any) => m.company_id))]) {
    const company = await getMarinaById(cid);
    if (!company) continue;
    out[company.company_name] = await runMarinaAutopay(company).catch((e: any) => ({ error: e?.message }));
  }
  return NextResponse.json({ success: true, settled, marinas: out });
}
