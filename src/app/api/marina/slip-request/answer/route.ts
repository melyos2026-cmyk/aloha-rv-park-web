import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { loadRequestByLink, quoteExpired } from "@/lib/marina/slipRequests";

// POST /api/marina/slip-request/answer { number, t, answer: "accept" | "decline", reason? }
// Oct 26 (per Mely — price before contract): the boater accepts or turns down the price the office
// sent, from the private tracker page. Accepting tells the office to send the contract.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `sranswer:${company.id}`, 10)) return NextResponse.json({ error: "Too many tries. Please call the marina." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const r = await loadRequestByLink(company.id, String(b.number || ""), String(b.t || ""));
  if (!r) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (r.status !== "quoted") return NextResponse.json({ error: "This price was already answered." }, { status: 409 });
  if (quoteExpired(r)) return NextResponse.json({ error: "This price expired. Call the marina or send a new request." }, { status: 409 });
  const now = new Date().toISOString();
  const accept = b.answer === "accept";
  const reason = String(b.reason || "").trim().slice(0, 300);
  const { data: done } = await supabaseAdmin.from("marina_slip_requests").update(
    accept ? { status: "quote_accepted", quote_answered_at: now, updated_at: now } : { status: "cancelled", quote_answered_at: now, decline_reason: `Boater said no to the price${reason ? `: ${reason}` : ""}`, updated_at: now },
  ).eq("id", r.id).eq("company_id", company.id).eq("status", "quoted").select("id");
  if (!done?.length) return NextResponse.json({ error: "This price was already answered." }, { status: 409 });
  if (!accept && r.waitlist_id) await supabaseAdmin.from("marina_waitlist").update({ status: "waiting", offered_slip_id: null, offered_at: null, request_id: null }).eq("id", r.waitlist_id).eq("company_id", company.id).then(() => null, () => null);
  const total = Number(r.quote_details?.total ?? r.quoted_amount ?? 0);
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: r.full_name, update_type: "slip_request",
    message: accept
      ? `${r.full_name} ACCEPTED the price for slip ${r.quote_details?.slip_name || ""} ($${total.toFixed(2)}), request ${r.request_number}. Send the contract from Slip Requests → Price accepted.`
      : `${r.full_name} turned down the price for request ${r.request_number}${reason ? `: "${reason}"` : ""}. The slip is free again.`,
  }).then(() => null, () => null);
  return NextResponse.json({ ok: true });
}
