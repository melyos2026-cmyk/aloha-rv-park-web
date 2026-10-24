import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { startConciergePayment } from "@/lib/marina/conciergePay";

// Oct 23 (per Mely): the boater approves (→ confirmed, the office then bills) or declines a quote.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = getMarinaSession(req);
  if (!s || s.companyId !== company.id) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const { data: r } = await supabaseAdmin.from("concierge_requests").select("*, concierge_services(name)").eq("id", String(b.id || "")).eq("company_id", company.id).eq("member_id", s.memberId).maybeSingle();
  if (!r || r.status !== "quoted") return NextResponse.json({ error: "Nothing to approve." }, { status: 400 });
  // Oct 24 (per Mely — pay first): approving a pay-now request pays it; it's confirmed once paid.
  if (b.approve && r.payment !== "account") {
    const pay = await startConciergePayment(company, { ...r, service_name: (r as any).concierge_services?.name }, s.memberId);
    if (!pay.ok) return NextResponse.json({ error: pay.error }, { status: pay.status });
    return NextResponse.json("url" in pay ? { ok: true, url: pay.url } : { ok: true, status: "confirmed", demo: true });
  }
  const status = b.approve ? "confirmed" : "cancelled";
  await supabaseAdmin.from("concierge_requests").update({ status, status_by_name: "Customer", updated_at: new Date().toISOString() }).eq("id", r.id);
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: null, update_type: "concierge_request", message: `Quote for ${r.request_number} was ${b.approve ? "approved by the customer — go ahead" : "declined by the customer"}.` }).then(() => null, () => null);
  return NextResponse.json({ ok: true, status });
}
