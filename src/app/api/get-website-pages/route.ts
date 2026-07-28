import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/get-website-pages?company_id=...
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId) {
    return NextResponse.json({ pages: [] });
  }

  const { data } = await supabase
    .from("website_pages")
    .select("page_name, title, slug")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ pages: data ?? [] });
}
