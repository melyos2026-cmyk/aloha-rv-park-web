import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { autopayStatus, startAutopay, confirmAutopay, stopAutopay, dueForAutopay, authText } from "@/lib/marina/autopay";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 26 (per Mely — Group 2): Boater login → Autopay.
// GET  → status, what's due now, the authorization text, whether bank is offered
// POST { action: "start", method: "card"|"ach", agree: true } → { url } (Stripe secure page) or { demo }
// POST { action: "confirm", session_id }  → back from Stripe: save it and turn autopay on
// POST { action: "off" }
async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return null;
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return null;
  return { company, memberId: s.memberId };
}
const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;

export async function GET(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const st = await autopayStatus(w.company.id, w.memberId);
  if (!st.ready) return NextResponse.json({ ready: false });
  const [due, fs] = await Promise.all([
    dueForAutopay(w.company.id, w.memberId),
    supabaseAdmin.from("company_fee_settings").select("ach_enabled").eq("company_id", w.company.id).maybeSingle(),
  ]);
  return NextResponse.json({ ...st, due: due.map((d) => ({ number: d.invoice_number, amount: d.balance, due: d.due_date })), bank: fs.data?.ach_enabled !== false, terms: { card: authText(w.company.company_name, "card"), ach: authText(w.company.company_name, "ach") } });
}

export async function POST(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (await tooManyFromIp(req, `autopay:${w.company.id}`, 15)) return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  if (b.action === "start") {
    if (b.agree !== true) return NextResponse.json({ error: "Check the box to authorize automatic payments." }, { status: 400 });
    const r = await startAutopay(w.company, w.memberId, b.method === "ach" ? "ach" : "card", ipOf(req)).catch((e: any) => ({ error: e?.message || "Could not start." }));
    return "error" in r ? NextResponse.json(r, { status: 400 }) : NextResponse.json(r);
  }
  if (b.action === "confirm") {
    const r = await confirmAutopay(w.company, w.memberId, String(b.session_id || ""), ipOf(req)).catch((e: any) => ({ error: e?.message || "Could not save." }));
    return "error" in r ? NextResponse.json(r, { status: 400 }) : NextResponse.json(r);
  }
  if (b.action === "off") { await stopAutopay(w.company, w.memberId); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
