import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { loadRequestByLink, quoteExpired } from "@/lib/marina/slipRequests";
import { autoContract, mailOffice, mailBoater, trackerLink } from "@/lib/marina/slipAuto";
import { money } from "@/lib/marina/contractCore";

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
  if (!accept && r.waitlist_id) {
    // Back in line (same place), and this slip is not offered to them again.
    const { data: wl } = await supabaseAdmin.from("marina_waitlist").select("skipped_slip_ids").eq("id", r.waitlist_id).eq("company_id", company.id).maybeSingle();
    const skipped = [...new Set([...(wl?.skipped_slip_ids || []), r.slip_id].filter(Boolean))];
    const back = { status: "waiting", offered_slip_id: null, offered_at: null, request_id: null };
    const { error: e1 } = await supabaseAdmin.from("marina_waitlist").update({ ...back, skipped_slip_ids: skipped }).eq("id", r.waitlist_id).eq("company_id", company.id);
    if (e1) await supabaseAdmin.from("marina_waitlist").update(back).eq("id", r.waitlist_id).eq("company_id", company.id).then(() => null, () => null);
  }
  const q = r.quote_details || {};
  const total = Number(q.total ?? r.quoted_amount ?? 0);
  // Oct 26 (per Mely): accepted → the contract goes out by itself (automatic mode).
  const k = accept ? await autoContract(company, { ...r, status: "quote_accepted" }).catch((e: any) => ({ ok: false as const, reason: e?.message || "error" })) : null;
  const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, "");
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: r.full_name, update_type: "slip_request",
    message: accept
      ? k?.ok ? `${r.full_name} accepted the price for slip ${q.slip_name || ""} (${money(total)}), request ${r.request_number}. The contract was sent automatically.` : `${r.full_name} ACCEPTED the price for slip ${q.slip_name || ""} (${money(total)}), request ${r.request_number}. Send the contract from Slip Requests → Price accepted.`
      : `${r.full_name} turned down the price for request ${r.request_number}${reason ? `: "${reason}"` : ""}. The slip is free again.`,
  }).then(() => null, () => null);
  await mailOffice(company, accept ? `${r.full_name} accepted slip ${q.slip_name || ""} (${r.request_number})` : `${r.full_name} said no to the price (${r.request_number})`, accept
    ? [`<b>${esc(r.full_name)}</b> accepted slip <b>${esc(q.slip_name)}</b> at <b>${money(total)}</b>.`, k?.ok ? "The contract was sent automatically. When they sign and pay the deposit, the slip is confirmed and the boat is placed in it." : `<b>Needs you:</b> the contract could not be sent automatically (${esc(k && !k.ok ? k.reason : "")}). Open Slip Requests → Price accepted → Send contract.`]
    : [`<b>${esc(r.full_name)}</b> turned down the price for slip ${esc(q.slip_name)}${reason ? `: “${esc(reason)}”` : ""}.`, r.waitlist_id ? "They stay on the waitlist; the slip will be offered to the next boat in line." : "The slip is free again."]);
  if (accept && !k?.ok) {
    await mailBoater(company, r.email, `Thank you, we got your answer (${r.request_number})`, "Thank you!", ["The office is preparing your contract and will email it to you shortly."], { label: "Track my request", url: trackerLink(company, r) });
  }
  return NextResponse.json({ ok: true, contract: !!k?.ok });
}
