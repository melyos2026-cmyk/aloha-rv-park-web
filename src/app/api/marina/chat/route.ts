import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { isDemoDomain } from "@/lib/marina/host";
import { loadPublicSlips, todayET } from "@/lib/marina/data";

const LEAD_TO_FALLBACK = "melyos2026@gmail.com";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// What Mely may say about MelyOS itself. Only facts that are true today; no prices, no invented clients or certifications.
const MELYOS_PITCH = `You are on the live demo of a MelyOS marina website. The visitor is most likely a marina owner, a marina manager, or someone from a city, county or other government that runs a marina. Your job is to explain MelyOS and, when they are interested, get them a quote.

About MelyOS (melyos.io): MelyOS is a software platform that runs the whole business of a marina, an RV park or a campground from one place. It is built and owned by MelyOS LLC in Kissimmee, Florida, and it already runs a real RV park.

What the marina platform includes (describe it from this website, which is the live example):
1. A public marina website like this one, with the marina's own name, logo and photos.
2. An interactive aerial map of the marina where every slip is a clickable shape with its own photo, size, power and water, and price. Wet slips, lift slips and dry storage are all supported.
3. Online reservations and payment: boaters pick a slip and dates, enter their boat details and pay online. In this demo the payment is simulated and no card is charged.
4. A calendar that shows when an occupied slip opens up (when the contract ends) and blocks dates that are already booked.
5. Boater accounts: boaters sign in with their email to see their boats, invoices and payments, and pay what they owe online.
6. A waitlist for the slips that are full, handled first come, first served.
7. An admin dashboard for the marina office: slips and rates, boat owners and boats, annual renewals, invoices, shift and daily close, collections report, event rooms, and the list of online reservations.
8. An AI assistant like me for each marina. Each marina decides what its own Mely knows and says, so a marina's Mely answers about that marina's slips, rules, hours and prices.
It also works for government marinas: the look is clean and formal, records are kept per payment and per invoice, and the office controls everything from the admin.

Pricing: never state or estimate a price. MelyOS gives each marina a custom quote. Never promise a delivery date, a discount, a certification or a feature that is not listed above. If asked about something not listed, say you will pass the question to the MelyOS team.

Qualifying question: early in the conversation, after you answer their first question, ask whether they own or manage a private marina or whether it is a government or public marina (city, county, state). Ask it naturally, once, and use the answer to tailor what you say (private: online reservations, revenue, boater accounts; government: clean formal records, per-payment receipts, office control, accountability). If they have several marinas, ask how many.

Getting a quote: when the person wants a quote, a demo of the admin side, or to talk to the team, collect these one at a time in a natural way: full name, email, phone (optional), the name of the marina or organization, whether it is private or government, and roughly how many slips they have. When you have at least their name, their email and the marina or organization, end your reply with this line by itself and nothing after it:
[[LEAD: name | email | phone | organization | private or government, slips and notes]]
Use a dash for anything unknown. Say that the MelyOS team will email them soon. The marker is invisible to the visitor, so never mention it. Only send it once per person.

If someone asks about booking a slip on this demo, explain that this is a demo marina with sample slips, and that they can try the Reserve online button on any open slip to see how it works for boaters.`;

const hits = new Map<string, number[]>();
function tooManyFromIp(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const k of hits.keys()) { if (!(hits.get(k) || []).some((t) => now - t < 600000)) hits.delete(k); }
  return recent.length > 25;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: Request) {
  const marina = await getMarinaForRequest(req);
  if (!marina) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const sessionId = text(body.sessionId, 80);
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .slice(-16)
    .map((m: any) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: text(m?.text, 1500) }))
    .filter((m: any) => m.content.trim());
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "Empty message." }, { status: 400 });
  while (history.length && history[0].role !== "user") history.shift();

  // Flood guards. The browser session id can be changed by anyone, so the real limits are
  // per IP (best effort, per server instance) and per marina (counted in the database).
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (tooManyFromIp(ip)) {
    return NextResponse.json({ reply: "You are sending messages very quickly. Please wait a few minutes and try again." }, { status: 429 });
  }
  {
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("mely_chat_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", marina.id)
      .eq("role", "user")
      .gte("created_at", hourAgo);
    if ((count || 0) >= 300) {
      return NextResponse.json({ reply: "Mely is very busy right now. Please try again in a little while, or email the team directly." }, { status: 429 });
    }
  }

  // One browser session, one hour.
  if (sessionId) {
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count } = await supabaseAdmin
      .from("mely_chat_logs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", marina.id)
      .eq("session_id", sessionId)
      .eq("role", "user")
      .gte("created_at", hourAgo);
    if ((count || 0) >= 40) {
      return NextResponse.json({ reply: "We have talked a lot in the last hour! For anything else, please email the team or come back a little later." });
    }
  }

  const demo = isDemoDomain(marina.domain);
  const { data: extra } = await supabaseAdmin.from("companies").select("ai_assistant_info").eq("id", marina.id).maybeSingle();
  const notes = extra?.ai_assistant_info
    ? `\n\nNotes written by this ${demo ? "demo" : "marina"}'s office (always current; follow them if they conflict with anything above):\n${extra.ai_assistant_info}`
    : "";

  const now = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

  let marinaFacts = "";
  if (!demo) {
    const slips = await loadPublicSlips(marina.id);
    const lines = slips.slice(0, 80).map((s) => {
      const r = s.rates.monthly ? s.rates.monthly.non_resident ?? s.rates.monthly.resident : null;
      return `${s.slip_name} (${s.slip_type}${s.dock ? `, ${s.dock}` : ""}${s.length_ft ? `, ${s.length_ft} ft` : ""}): ${s.status}${s.available_from && s.status === "occupied" ? ` until ${s.available_from}` : ""}${r ? `, monthly $${r}` : ""}`;
    });
    marinaFacts = `\n\nSlips right now (today is ${todayET()}):\n${lines.join("\n")}\nBoaters can reserve an open slip online with the Reserve online button on the slip map, or join the waitlist for full ones. Never promise a slip for a date; the booking calendar on the website is the source of truth.`;
  }

  const identity = demo
    ? `You are Mely, the friendly AI assistant of MelyOS, shown as the assistant of the demo website "${marina.company_name}".`
    : `You are Mely, the friendly AI assistant of ${marina.company_name}${marina.address ? `, located at ${marina.address}` : ""}.${marina.contact_phone ? ` Office phone: ${marina.contact_phone}.` : ""}${marina.contact_email ? ` Email: ${marina.contact_email}.` : ""} Only talk about this marina using the information below; if you do not know something, say so and send the person to the office.`;

  const system = `${identity}
Right now it is ${now} (Eastern Time).

${demo ? MELYOS_PITCH : "Answer questions from boaters and visitors about the marina: slips, availability, rates, reservations, the waitlist, boater accounts and payments."}${marinaFacts}${notes}

Style: warm, kind and professional, with a nautical-elegant tone. Answer fully but briefly, in short paragraphs. Ask at most one question at a time. Reply in the same language the person just wrote in.
Formatting: this chat shows plain text only. Never use markdown (no asterisks, no dashes as bullets, no headers). For a list, put each item on its own line as "1. ", "2. " with a blank line between items.
Identity: you are an AI assistant created by MelyOS. Never claim to be human. If asked which AI model runs you, say you do not have those details.
Privacy: never share or confirm anything about a specific person, boat owner, account or payment. Decline politely.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 900, system, messages: history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("marina chat: Anthropic error", data);
    return NextResponse.json({ error: "Chat service error" }, { status: 502 });
  }
  const raw: string = (data.content || []).find((b: any) => b.type === "text")?.text || "Sorry, I could not get a response.";

  const lead = raw.match(/\[\[LEAD:\s*([\s\S]+?)\]\]\s*$/);
  const reply = (lead ? raw.slice(0, lead.index) : raw).trim();

  if (sessionId) {
    await supabaseAdmin.from("mely_chat_logs").insert([
      { company_id: marina.id, session_id: sessionId, role: "user", content: history[history.length - 1].content },
      { company_id: marina.id, session_id: sessionId, role: "assistant", content: reply },
    ]);
  }

  if (lead && process.env.RESEND_API_KEY) {
    const [name = "-", email = "-", phone = "-", org = "-", notes2 = "-"] = lead[1].split("|").map((x) => x.trim().slice(0, 300));
    const transcript = history.map((m: any) => `${m.role === "user" ? "Visitor" : "Mely"}: ${m.content}`).join("\n\n");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${marina.company_name} <noreply@aloharvparkfl.com>`,
        to: demo ? LEAD_TO_FALLBACK : marina.contact_email || LEAD_TO_FALLBACK,
        reply_to: /@/.test(email) ? email : undefined,
        subject: demo ? `New MelyOS quote request: ${org}` : `New enquiry from your website chat: ${name}`,
        html: `<p><b>Name:</b> ${esc(name)}<br/><b>Email:</b> ${esc(email)}<br/><b>Phone:</b> ${esc(phone)}<br/><b>Organization:</b> ${esc(org)}<br/><b>Slips / notes:</b> ${esc(notes2)}</p><hr/><pre style="white-space:pre-wrap;font-family:inherit">${esc(transcript)}</pre>`,
      }),
    }).catch((e) => console.error("marina chat: lead email failed", e));
  }

  return NextResponse.json({ reply });
}
