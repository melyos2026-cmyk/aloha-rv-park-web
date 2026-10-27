import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rulesForState } from "@/lib/marina/serviceStateRules";

// Oct 26 (per Mely — work orders): the boat owner's view of a work order estimate. Private: the
// link carries a random token (?t=…) the marina sends by email / Boater login. Same math as the
// admin (lib/marinaWorkOrders.ts in melyos-builder).

const r2 = (n: number) => Math.round(n * 100) / 100;
export const CATEGORY_LABEL: Record<string, string> = {
  mechanical: "Engine & mechanical", electrical: "Electrical", hull_paint: "Hull & bottom paint", detailing: "Cleaning & detailing", haul_out: "Haul-out & storage",
  rigging: "Rigging & sails", electronics: "Electronics", plumbing: "Plumbing", hvac: "A/C & refrigeration", canvas: "Canvas & upholstery", inspection: "Inspection / survey", other: "Other",
};

export function sameToken(a: string | null | undefined, b: string | null | undefined) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function loadWorkOrderByLink(companyId: string, number: string, token: string) {
  if (!number || !/^[a-f0-9]{32}$/.test(token)) return null;
  const { data: wo, error } = await supabaseAdmin.from("marina_work_orders").select("*").eq("company_id", companyId).eq("wo_number", number).maybeSingle();
  if (error || !wo || !sameToken(wo.approval_token, token)) return null;
  const [{ data: lines }, { data: st }, boat, member, slip] = await Promise.all([
    supabaseAdmin.from("marina_work_order_lines").select("kind, description, qty, unit_price, taxable").eq("company_id", companyId).eq("work_order_id", wo.id).order("sort"),
    // Oct 26 (per Mely — rules by state): taxable shop fee + lien notice (state defaults when unset)
    supabaseAdmin.from("marina_service_settings").select("parts_tax_pct, shop_fee_pct, shop_fee_taxable, lien_notice").eq("company_id", companyId).maybeSingle()
      .then(async (r) => (r.error ? await supabaseAdmin.from("marina_service_settings").select("parts_tax_pct, shop_fee_pct").eq("company_id", companyId).maybeSingle() : r)),
    wo.boat_id ? supabaseAdmin.from("marina_boats").select("boat_name, make_model, length_ft").eq("id", wo.boat_id).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null } as any),
    wo.member_id ? supabaseAdmin.from("marina_members").select("full_name").eq("id", wo.member_id).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null } as any),
    wo.slip_id ? supabaseAdmin.from("marina_slips").select("slip_name").eq("id", wo.slip_id).eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  const { data: co } = await supabaseAdmin.from("companies").select("state").eq("id", companyId).maybeSingle();
  const rules = rulesForState((co as any)?.state);
  const shopTaxable = typeof (st as any)?.shop_fee_taxable === "boolean" ? (st as any).shop_fee_taxable : !!rules.shop_fee_taxable;
  const lienNotice = ((st as any)?.lien_notice && String((st as any).lien_notice).trim()) || rules.lien_notice;
  const L = (lines || []).map((l: any) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), amount: r2(Number(l.qty) * Number(l.unit_price)) }));
  const sum = (k: string) => r2(L.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0));
  const labor = sum("labor"), parts = sum("part"), fees = sum("fee");
  const shopFee = r2(labor * Number(st?.shop_fee_pct || 0) / 100);
  const tax = r2((L.filter((l) => l.taxable).reduce((a, l) => a + l.amount, 0) + (shopTaxable ? shopFee : 0)) * Number(st?.parts_tax_pct || 0) / 100);
  return {
    id: wo.id, number: wo.wo_number, status: wo.status as string, title: wo.title, description: wo.description, category: CATEGORY_LABEL[wo.category] || String(wo.category || "").replace(/^custom:/, ""),
    customer_notes: wo.customer_notes, scheduled_start: wo.scheduled_start, scheduled_end: wo.scheduled_end, due_date: wo.due_date,
    approved_at: wo.approved_at, approved_by_name: wo.approved_by_name, declined_reason: wo.declined_reason, invoice_id: wo.invoice_id,
    photos: (Array.isArray(wo.photos) ? wo.photos : []) as { url: string; label: string | null }[],
    boat: boat?.data || null, owner: member?.data?.full_name || null, slip: slip?.data?.slip_name || null, member_id: wo.member_id as string | null,
    lien_notice: lienNotice,
    lines: L, totals: { labor, parts, fees, shopFee, tax, total: r2(labor + parts + fees + shopFee + tax) },
  };
}
