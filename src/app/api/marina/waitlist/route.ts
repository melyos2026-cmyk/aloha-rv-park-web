import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";

const CONTRACTS = ["annual", "seasonal", "monthly", "transient"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const feet = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 10) / 10 : null;
};

// POST /api/marina/waitlist — a visitor joins this marina's waitlist.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Hidden field real people never fill in; bots do. Pretend it worked.
  if (text(body.website, 100)) return NextResponse.json({ ok: true });

  const fullName = text(body.full_name, 120);
  const email = text(body.email, 160).toLowerCase();
  const phone = text(body.phone, 40);
  if (fullName.length < 2) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  // Basic flood guard: no more than 100 sign-ups per marina per hour.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("marina_waitlist")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .gte("created_at", since);
  if ((count || 0) >= 100) {
    return NextResponse.json({ error: "Too many requests right now. Please call the marina office." }, { status: 429 });
  }

  // Already waiting under this email: confirm without creating a duplicate.
  const { data: existing } = await supabaseAdmin
    .from("marina_waitlist")
    .select("id")
    .eq("company_id", company.id)
    .eq("status", "waiting")
    .ilike("email", email)
    .limit(1);
  if (existing && existing.length) return NextResponse.json({ ok: true });

  const contract = CONTRACTS.includes(body.desired_contract_type) ? body.desired_contract_type : null;
  const { error } = await supabaseAdmin.from("marina_waitlist").insert({
    company_id: company.id,
    full_name: fullName,
    email,
    phone: phone || null,
    is_resident: !!body.is_resident,
    boat_name: text(body.boat_name, 120) || null,
    boat_length_ft: feet(body.boat_length_ft),
    boat_beam_ft: feet(body.boat_beam_ft),
    boat_draft_ft: feet(body.boat_draft_ft),
    desired_contract_type: contract,
    notes: text(body.notes, 1000) || null,
    status: "waiting",
  });
  if (error) return NextResponse.json({ error: "Could not save your request. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
