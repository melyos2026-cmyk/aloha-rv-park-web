import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { loadWorkOrderByLink } from "@/lib/marina/workOrders";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { getMarinaSession } from "@/lib/marina/session";

// POST /api/marina/work-order  { number, token, action: "approve" | "decline", name, reason? }
// Oct 26 (per Mely — work orders): the boat owner approves or declines an estimate from the
// private link. Approving needs the owner to type their name (recorded with date, time and IP).
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `wo:${company.id}`, 30)) return NextResponse.json({ error: "Too many tries. Please call the marina." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const wo = await loadWorkOrderByLink(company.id, String(b.number || ""), String(b.token || ""));
  if (!wo) return NextResponse.json({ error: "This link is not valid anymore. Please contact the marina." }, { status: 404 });
  if (wo.status !== "awaiting_approval") return NextResponse.json({ error: wo.status === "approved" || wo.approved_at ? "This estimate was already approved." : "This estimate isn't waiting for approval." }, { status: 409 });
  const name = String(b.name || "").trim().slice(0, 120);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || null;
  const now = new Date().toISOString();

  if (b.action === "approve") {
    if (name.length < 3) return NextResponse.json({ error: "Type your full name to approve." }, { status: 400 });
    if (!b.agree) return NextResponse.json({ error: "Please check the box to approve the work and price." }, { status: 400 });
    const { data: done } = await supabaseAdmin.from("marina_work_orders")
      .update({ status: "approved", approved_at: now, approved_by_name: name, approved_total: wo.totals.total, declined_reason: null, status_by_name: "Owner (online)", updated_at: now })
      .eq("id", wo.id).eq("company_id", company.id).eq("status", "awaiting_approval").select("id");
    if (!done?.length) return NextResponse.json({ error: "This estimate was already answered." }, { status: 409 });
    await supabaseAdmin.from("marina_work_order_events").insert({ company_id: company.id, work_order_id: wo.id, event: `Approved online by ${name} ($${wo.totals.total.toFixed(2)})${ip ? ` · IP ${ip}` : ""}`, by_name: name }).then(() => null, () => null);
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: wo.owner || name, update_type: "work_order", message: `${wo.number} approved by ${name}: ${wo.title}${wo.boat?.boat_name ? ` (${wo.boat.boat_name})` : ""} — $${wo.totals.total.toFixed(2)}. Ready to start.` }).then(() => null, () => null);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "decline") {
    const reason = String(b.reason || "").trim().slice(0, 300);
    const { data: done } = await supabaseAdmin.from("marina_work_orders")
      .update({ status: "declined", declined_reason: reason || "No reason given", status_by_name: "Owner (online)", updated_at: now })
      .eq("id", wo.id).eq("company_id", company.id).eq("status", "awaiting_approval").select("id");
    if (!done?.length) return NextResponse.json({ error: "This estimate was already answered." }, { status: 409 });
    await supabaseAdmin.from("marina_work_order_events").insert({ company_id: company.id, work_order_id: wo.id, event: `Declined online${name ? ` by ${name}` : ""}${reason ? `: ${reason}` : ""}`, by_name: name || "Owner" }).then(() => null, () => null);
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: wo.owner || name || "Boat owner", update_type: "work_order", message: `${wo.number} was declined by the owner${reason ? `: “${reason}”` : "."}` }).then(() => null, () => null);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// GET /api/marina/work-order — the signed-in boater's own work orders (Boater login).
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return NextResponse.json({ workOrders: [] });
  const { data, error } = await supabaseAdmin.from("marina_work_orders").select("id, wo_number, title, status, approval_token, boat_id, scheduled_start, due_date, created_at")
    .eq("company_id", company.id).eq("member_id", s.memberId).neq("status", "draft").order("created_at", { ascending: false }).limit(30);
  if (error) return NextResponse.json({ workOrders: [] });
  const out = [];
  for (const w of data || []) {
    const full = w.approval_token ? await loadWorkOrderByLink(company.id, w.wo_number, w.approval_token) : null;
    out.push({ number: w.wo_number, title: w.title, status: w.status, boat: full?.boat?.boat_name || null, total: full?.totals.total ?? null, link: w.approval_token ? `/marina/work-order/${encodeURIComponent(w.wo_number)}?t=${w.approval_token}` : null, due_date: w.due_date });
  }
  return NextResponse.json({ workOrders: out });
}
