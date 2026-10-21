import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";

// Oct 21 (per Mely): the signed-in boater's own messages with the marina office.
// Private: only this boater's copies; replies go only to the office.
async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const s = getMarinaSession(req);
  if (!s || s.companyId !== company.id) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  return { companyId: company.id, memberId: s.memberId };
}

// GET → { messages, unread }   ·   GET ?read=1 marks the office's messages as read
export async function GET(req: Request) {
  const w = await who(req);
  if (w.error) return w.error;
  const { data, error } = await supabaseAdmin.from("marina_messages")
    .select("id, direction, subject, body, sent_by_name, read_at, created_at")
    .eq("company_id", w.companyId).eq("member_id", w.memberId).order("created_at").limit(300);
  if (error) return NextResponse.json({ messages: [], unread: 0 }); // not set up yet
  const unread = (data || []).filter((m) => m.direction === "office" && !m.read_at).length;
  if (new URL(req.url).searchParams.get("read") === "1" && unread) {
    await supabaseAdmin.from("marina_messages").update({ read_at: new Date().toISOString() })
      .eq("company_id", w.companyId).eq("member_id", w.memberId).eq("direction", "office").is("read_at", null);
  }
  return NextResponse.json({ messages: data || [], unread });
}

// POST { body } → a reply to the office
export async function POST(req: Request) {
  const w = await who(req);
  if (w.error) return w.error;
  let body = "";
  try { body = String((await req.json()).body || "").trim().slice(0, 3000); } catch {}
  if (!body) return NextResponse.json({ error: "Write your message." }, { status: 400 });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin.from("marina_messages").select("id", { count: "exact", head: true })
    .eq("member_id", w.memberId).eq("direction", "boater").gte("created_at", since);
  if ((count || 0) >= 20) return NextResponse.json({ error: "Too many messages in the last hour. Please call the office." }, { status: 429 });
  const { error } = await supabaseAdmin.from("marina_messages").insert({ company_id: w.companyId, member_id: w.memberId, direction: "boater", body });
  if (error) return NextResponse.json({ error: "Could not send. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
