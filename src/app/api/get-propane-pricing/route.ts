import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// GET /api/get-propane-pricing?park_id=aloha
export async function GET(req: NextRequest) {
  const parkId = req.nextUrl.searchParams.get("park_id") || "aloha";

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .select("id")
    .eq("park_id", parkId)
    .single();

  if (companyErr || !company) {
    return NextResponse.json({ error: "Park not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("propane_pricing")
    .select("product_id, label, price, unit, taxable")
    .eq("company_id", company.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: taxSettings } = await supabase
    .from("company_tax_settings")
    .select("enable_tax, manual_tax_rate_percent")
    .eq("company_id", company.id)
    .maybeSingle();

  return NextResponse.json({
    products: data ?? [],
    tax: {
      enabled: !!taxSettings?.enable_tax,
      ratePercent: Number(taxSettings?.manual_tax_rate_percent || 0),
    },
  });
}
