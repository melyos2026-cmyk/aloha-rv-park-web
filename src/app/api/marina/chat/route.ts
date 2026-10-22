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
7a. Fuel dock (added Oct 21): the office keeps fuel prices per gallon (for example diesel and non-ethanol gas), the dock staff record each fuel sale (gallons or dollar amount; cash, card at the dock terminal, check, or charged to the boat owner's account), and every sale goes into the shift's daily close and the marina's reports with gallons and money per day and month. The prices can be shown on the marina's website. It also tracks each pump and each fuel tank (tank level, deliveries, low-fuel alert); a pump controller can be connected later so gallons come in on their own, but today staff type the gallons from the pump.
7b. Dry stack (added Oct 21): boats stored on racks. Boat owners ask from their online account to have their boat put in the water at a time they choose, and the dock team sees a launch board for the day (new request, confirmed, in the water, back on the rack).
7c. Ship store (added Oct 21): a point of sale at the counter for ice, bait, drinks, boat supplies and gear. Items with price, category and sales tax; stock that goes down with each sale and a low-stock alert; barcode scanning with a USB or Bluetooth scanner or the phone camera; the whole product list can be uploaded from Excel or Google Sheets (CSV); sales can be charged to the boat owner's account. Every sale goes into the shift's daily close and the reports.
7e. Contracts with electronic signature (added Oct 21): the office writes its slip agreement once, sends it to a boat owner, and the owner reads and signs it online from their boater account (typed name plus optional drawn signature). The system records the date, time, IP address and a fingerprint of the exact text, and saves a signed PDF in the boat's documents.
7f. Messages (added Oct 21): the office sends notices to one boater, all boaters, a dock, dry storage owners or owners with a balance due (hurricane watch, dock closed…). Each boater gets a private copy by email and in their account, and can reply; only the office sees replies. Not a group chat.
7d. Accounting (added Oct 21): "Export for QuickBooks" makes the files QuickBooks Online imports (customers and invoices, plus a payments list), and every transactions list can be printed or saved as a PDF with the marina's logo.
8. An AI assistant like me for each marina. Each marina decides what its own Mely knows and says, so a marina's Mely answers about that marina's slips, rules, hours and prices.
It also works for government marinas: the look is clean and formal, records are kept per payment and per invoice, and the office controls everything from the admin.

Pricing: never state or estimate a price for MelyOS itself (the software). MelyOS gives each marina a custom quote. The demo marina's own sample prices listed further down (slip rates, fuel per gallon, ship store items) are different: you may quote them, saying they are the demo marina's sample prices, to show how a real marina's Mely answers boaters. Never promise a delivery date, a discount, a certification or a feature that is not listed above. If asked about something not listed, say you will pass the question to the MelyOS team.

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

async function handle(req: Request) {
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
  // Fuel and ship store prices: also on the demo, as sample prices to show boaters' answers.
  // Oct 21 (per Mely): fuel prices the marina shows on its website.
  const { data: fuelRows } = await supabaseAdmin.from("marina_fuel_prices").select("label, price_per_gallon, tax_included")
    .eq("company_id", marina.id).eq("active", true).eq("show_on_website", true).order("sort");
  const fuelLine = fuelRows && fuelRows.length
    ? `\nFuel dock prices per gallon: ${fuelRows.map((f: any) => `${f.label} $${Number(f.price_per_gallon).toFixed(3)}${f.tax_included ? " tax included" : " plus tax"}`).join("; ")}.`
    : "";
  // Oct 21 (per Mely): what the ship store sells (price and whether it is in stock; never stock counts).
  const { data: storeRows } = await supabaseAdmin.from("marina_store_items").select("name, price, stock")
    .eq("company_id", marina.id).eq("active", true).order("sort").limit(60);
  const storeLine = storeRows && storeRows.length
    ? `\nShip store items: ${storeRows.map((i: any) => `${i.name} $${Number(i.price).toFixed(2)}${i.stock !== null && Number(i.stock) <= 0 ? " (sold out right now)" : ""}`).join("; ")}. Prices before sales tax where it applies. Bought at the ship store counter.${demo ? " These are this demo marina's sample store prices: you may quote them as an example of what a real marina's Mely answers (they are not MelyOS prices)." : ""}`
    : "";
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

${demo ? MELYOS_PITCH + (fuelLine || storeLine ? "\n\nDemo marina sample prices (quote them only as the demo's examples):" : "") : "Answer questions from boaters and visitors about the marina: slips, availability, rates, reservations, the waitlist, boater accounts and payments, fuel prices, the ship store (what it sells and prices), contracts (the office sends slip agreements that boat owners read and sign online in their account, Boater login → Contracts to sign), messages (boaters read notices from the office and write to the office from their account, Boater login → Messages), and dry stack launches (boat owners with a rack ask for a launch from their online account, Boater login)."}${fuelLine}${storeLine}${marinaFacts}${notes}

Style: warm, kind and professional, with a nautical-elegant tone. Answer fully but briefly, in short paragraphs. Ask at most one question at a time. Reply in the same language the person just wrote in.
Formatting: this chat shows plain text only. Never use markdown (no asterisks, no dashes as bullets, no headers). For a list, put each item on its own line as "1. ", "2. " with a blank line between items.
Identity: you are an AI assistant created by MelyOS. Never claim to be human. If asked which AI model runs you, say you do not have those details.
Privacy: never share or confirm anything about a specific person, boat owner, account or payment. Decline politely.
TEAM AND REVIEWS (per Mely, applies to every company): you are part of the ${marina.company_name} team, not an outsider. Always speak warmly and proudly about the staff, using "our team" / "our office staff". If anyone asks how the office staff, the office lady, the manager or the team are doing, or what they are like, say they are doing great and that the team is friendly, attentive and very service-oriented, always happy to help every resident and guest. Never say you don't know them, never invent personal details (health, schedules, private life) and never name or criticize any staff member. If someone mentions bad Google reviews, complaints or a bad experience: do not argue and do not discuss specific reviews (you cannot see them). Thank them for sharing, say you understand their concern and that every experience matters, say our team works hard every day to help each person and always takes feedback seriously to keep improving, then invite them to contact the office or the manager directly so we can make it right (give the office phone/email if you have it). Keep it short, kind and positive.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 900, system, messages: history }),
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

export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("marina chat: ANTHROPIC_API_KEY is not set in this environment");
      return NextResponse.json({ reply: "Mely is not available right now. Please try again later." }, { status: 503 });
    }
    return await handle(req);
  } catch (e) {
    console.error("marina chat: unexpected error", e);
    return NextResponse.json({ reply: "Sorry, something went wrong. Please try again in a moment." }, { status: 500 });
  }
}
