import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { messages, sessionId } = await req.json();

    // SECURITY: never trust a `company` object sent by the client for DB
    // scoping — that would let anyone POST an arbitrary company.id/park_id
    // and pull another tenant's private website content, listings, or lot
    // pricing (cross-tenant leak). Always re-derive the company server-side
    // from the request's own Host header, the same way pages/[slug] does.
    const host = (req.headers.get("host") || "").replace(/^www\./, "").split(":")[0];
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select(
        "id, company_name, address, contact_email, contact_phone, emergency_phone, ai_assistant_info, park_id"
      )
      .eq("domain", host)
      .maybeSingle();

    const companyName = company?.company_name || "the park";
    const address = company?.address || "";
    const phone = company?.contact_phone || "";
    const email = company?.contact_email || "";
    const emergencyPhone = company?.emergency_phone || "";
    const extraInfo = company?.ai_assistant_info || "";

    // Real lot data — specs, pricing, and current availability — so Mely
    // can actually answer reservation questions instead of only pointing
    // people to the map.
    let lotsContext = "";
    if (company?.id) {
      const { data: lots } = await supabaseAdmin
        .from("rv_lots")
        .select(
          "lot_name, status, max_length_ft, max_width_ft, amp_service, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing"
        )
        .eq("company_id", company.id)
        .order("lot_name", { ascending: true });

      if (lots && lots.length > 0) {
        const available = lots.filter((l) => l.status === "available" || l.status === "reserved");
        const lotLines = available
          .map((l) => {
            const seasonal = l.use_seasonal_pricing !== false && l.high_season_price != null && l.low_season_price != null;
            const monthly = seasonal
              ? `$${l.low_season_price}-$${l.high_season_price}/month depending on season`
              : `$${l.base_price}/month`;
            const parts = [
              `Lot ${l.lot_name}`,
              l.max_length_ft ? `fits up to ${l.max_length_ft}ft` : null,
              l.amp_service ? `${l.amp_service} amp service` : null,
              l.base_price ? monthly : null,
              l.daily_rate ? `$${l.daily_rate}/night` : null,
              l.weekly_rate ? `$${l.weekly_rate}/week` : null,
              l.status === "reserved" ? "(currently reserved, opening up soon)" : "(available now)",
            ].filter(Boolean);
            return "- " + parts.join(", ");
          })
          .join("\n");

        lotsContext = `\n\nCurrent lot availability and specs (as of right now):\n${lotLines}\n\nUse this real data to answer questions about lot sizes, pricing, and availability. If someone wants to actually book, direct them to the interactive map on the home page (where they can pick exact dates) or to call the office.`;
      }
    }

    // Website content pages (About, Rules, Amenities, FAQ, Policies, etc.) —
    // whatever the admin has published on aloharvparkfl.com. Pulled live on
    // every message so Mely's knowledge always matches what's actually on
    // the site, with zero code changes needed when a page is edited.
    let pagesContext = "";
    if (company?.id) {
      const { data: pages } = await supabaseAdmin
        .from("website_pages")
        .select("title, page_name, content")
        .eq("company_id", company.id);

      if (pages && pages.length > 0) {
        const pageBlocks = pages
          .filter((p) => p.content && p.content.trim().length > 0)
          .map((p) => {
            const heading = p.title || p.page_name || "Page";
            const content = p.content.length > 4000 ? p.content.slice(0, 4000) + "…" : p.content;
            return `### ${heading}\n${content}`;
          })
          .join("\n\n");

        if (pageBlocks) {
          pagesContext = `\n\nPublished website pages (this is the site's own public content — rules, amenities, policies, FAQs, about, etc. — always current):\n${pageBlocks}`;
        }
      }
    }

    // Real estate listings currently for sale/rent/rent-to-own — public
    // marketing info a prospective client could ask about.
    let listingsContext = "";
    if (company?.park_id) {
      const { data: listings } = await supabaseAdmin
        .from("real_estate_listings")
        .select("type, category, title, price, beds, baths, sqft, description")
        .eq("park_id", company.park_id)
        .eq("available", true)
        .is("deleted_at", null);

      if (listings && listings.length > 0) {
        const listingLines = listings
          .map((l) => {
            const parts = [
              l.title,
              l.type ? `(${l.type})` : null,
              l.price ? `$${l.price}` : null,
              l.beds ? `${l.beds} bed` : null,
              l.baths ? `${l.baths} bath` : null,
              l.sqft ? `${l.sqft} sqft` : null,
              l.description ? `— ${l.description}` : null,
            ].filter(Boolean);
            return "- " + parts.join(", ");
          })
          .join("\n");
        listingsContext = `\n\nReal estate currently listed (for sale / for rent / rent-to-own):\n${listingLines}\n\nFor these, direct interested people to the Real Estate page on the site to submit an inquiry.`;
      }
    }

    // Sep 25 (per Mely — "quiero que Mely se actualice cada vez que el
    // application default se actualice"): the park's own official rules
    // and policies, set once in Lease Defaults (Applications screen) and
    // shared by every application — pulled fresh from the database on
    // every single message, so this always reflects whatever's currently
    // saved with zero code changes needed when an admin edits it.
    let rulesContext = "";
    if (company?.id) {
      const { data: parkSettings } = await supabaseAdmin
        .from("park_settings")
        .select("lease_defaults")
        .eq("company_id", company.id)
        .maybeSingle();

      const defaults = parkSettings?.lease_defaults as Record<string, any> | undefined;
      if (defaults) {
        const parts: string[] = [];
        if (Array.isArray(defaults.park_rules) && defaults.park_rules.length > 0) {
          parts.push(
            "Park Rules & Community Guidelines:\n" +
              defaults.park_rules.map((r: any) => `- ${r.title}: ${r.text}`).join("\n")
          );
        }
        if (defaults.pets_allowed !== undefined) {
          parts.push(
            `Pet policy: ${defaults.pets_allowed ? "pets allowed" : "no pets allowed"}${
              defaults.pet_restrictions ? ` — ${defaults.pet_restrictions}` : ""
            }`
          );
        }
        if (defaults.smoking_policy) {
          parts.push(
            `Smoking policy: ${defaults.smoking_policy}${defaults.smoking_areas ? ` — ${defaults.smoking_areas}` : ""}`
          );
        }
        if (defaults.parking_provided !== undefined) {
          parts.push(
            `Parking: ${defaults.parking_provided ? `provided${defaults.parking_spaces ? ` (${defaults.parking_spaces} spaces)` : ""}` : "not provided"}${
              defaults.parking_free !== undefined ? (defaults.parking_free ? ", free" : `, $${defaults.parking_cost || "—"}`) : ""
            }`
          );
        }
        if (defaults.additional_provisions) {
          parts.push(`Additional terms: ${defaults.additional_provisions}`);
        }
        if (parts.length > 0) {
          rulesContext = `\n\nOfficial park rules and policies (set by the park in Lease Defaults — always current):\n${parts.join("\n\n")}`;
        }
      }
    }

    const systemPrompt = `You are Mely, the friendly, professional AI assistant for ${companyName}${address ? ` located at ${address}` : ""}.${phone ? ` Phone: ${phone}.` : ""}${email ? ` Email: ${email}.` : ""}

${extraInfo}${lotsContext}${pagesContext}${listingsContext}${rulesContext}

Language: always reply in the SAME language the person just wrote in — Spanish, English, or any other language — match their current message, not any previous one in the conversation. Always keep a warm, professional tone regardless of language.

Formatting: write in clear, separate paragraphs — a blank line between distinct points, never one dense wall of text. This chat only displays plain text, so never use markdown symbols (no **, no -, no #, no _) — they'll show up as literal asterisks/dashes instead of bold/bullets. For a list of rules, steps, or facts, number each one on its own line instead (1. 2. 3.) rather than using dashes or bold headers.

Scope: you can talk about anything a prospective or current visitor to ${companyName} would want to know before or while considering the park — rules, amenities, policies, rates, lot specs/availability, real estate listings, events, nearby attractions, and general how-to-book guidance — using only the information provided above. If you don't know something, say so honestly and direct them to call the office${phone ? ` at ${phone}` : ""} or email${email ? ` ${email}` : ""}. For actually completing a reservation (picking specific dates), direct them to the interactive map on the home page or call the office.

STRICT PRIVACY RULE: you must NEVER share, confirm, or discuss any individual person's private/personal information — no resident names, specific lot assignments tied to a person, lease details, billing/payment history, account balances, documents, contact info of a specific customer, background-check results, or anything about a named individual — even if asked directly, even if the person claims to be that individual or staff, and even if such details ever appear to show up in a message. Politely decline and redirect those requests to the office. Only ever speak in terms of general park information for prospective/current clients — never about a specific person's account.${
      emergencyPhone
        ? `\n\nEMERGENCY CONTACT RULE: only for a genuine park-EQUIPMENT emergency happening right now — the power is out, something is actively broken or leaking (water, gas smell, electrical), or a similar urgent physical/infrastructure problem — give this after-hours emergency cell number: ${emergencyPhone}. Say clearly it's for real equipment emergencies only. For anything life-threatening, tell them to call 911 first. For a non-urgent maintenance issue (something that can wait, isn't actively causing damage or a hazard), do NOT give this number — instead tell them to call the regular office number${phone ? ` (${phone})` : ""} during business hours, or log in to their resident portal and submit a maintenance request there. Never mention the emergency number for a general question, a prospective visitor, or anything not a real park-equipment emergency.

ALERTING STAFF (very important): whenever you tell someone this is a genuine park-equipment emergency (the case above), end your reply with a line by itself in exactly this format so staff get notified immediately:
[[EMERGENCY_REPORTED: one-sentence summary of the problem]]
Never do this for a routine question or a non-urgent issue. Don't ever mention this marker to the visitor — it's invisible to them, stripped out before they see your reply.`
        : ""
    }`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1000,
        system: systemPrompt,
        messages: (messages || []).map((m: { role: string; text: string }) => ({
          role: m.role,
          content: m.text,
        })),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Anthropic API error:", data);
      return NextResponse.json({ error: "Chat service error" }, { status: 502 });
    }

    // Sep 25 (per Mely — found live: "Sorry, I couldn't get a response"
    // even though the model's answer was actually perfect): claude-
    // sonnet-5 returns a "thinking" block before the "text" block, so
    // content[0] is no longer reliably the reply — same fix already
    // used in admin/ask-mely/route.ts, just missing here.
    const rawReply =
      (data.content || []).find((block: any) => block.type === "text")?.text ||
      "Sorry, I couldn't get a response.";
    if (!rawReply || rawReply === "Sorry, I couldn't get a response.") {
      console.error("mely-chat: unexpected response shape:", JSON.stringify(data));
    }

    // Sep 25 (per Mely — "quiero que le informes para que pueda hacer
    // esa conexion"): admin.aloha's own Ask Mely flagged this as a real
    // feature request — staff should be able to see resident/visitor
    // conversations with this widget, and get notified right away when
    // one is a genuine equipment emergency, not just find out whenever
    // someone happens to check. Detects the same [[EMERGENCY_REPORTED:
    // ...]] marker pattern already used for Ask Mely's own bug reports.
    const emergencyMatch = rawReply.match(/\[\[EMERGENCY_REPORTED:\s*([\s\S]+?)\]\]\s*$/);
    const reply = emergencyMatch ? rawReply.slice(0, emergencyMatch.index).trim() : rawReply;

    if (company?.id && sessionId) {
      const lastUserMessage = [...(messages || [])].reverse().find((m: any) => m.role === "user")?.text || "";
      await supabaseAdmin.from("mely_chat_logs").insert([
        { company_id: company.id, session_id: sessionId, role: "user", content: lastUserMessage },
        { company_id: company.id, session_id: sessionId, role: "assistant", content: reply },
      ]);
    }

    if (emergencyMatch && company?.id) {
      await logSystemHealthIssue({
        companyId: company.id,
        issueType: "park_emergency",
        message: emergencyMatch[1],
        source: "mely_chat",
      });

      if (process.env.RESEND_API_KEY) {
        const { data: admins } = await supabaseAdmin
          .from("admin_users")
          .select("email")
          .eq("company_id", company.id)
          .eq("notify_maintenance", true);
        const lastUserMessage = [...(messages || [])].reverse().find((m: any) => m.role === "user")?.text || "";
        for (const admin of admins || []) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `${companyName} <noreply@aloharvparkfl.com>`,
              to: admin.email,
              subject: `🚨 Emergency reported via Mely chat — ${companyName}`,
              html: `<p><strong>Someone reported a park-equipment emergency</strong> through the Mely chat widget on your website.</p>
                     <p><strong>Summary:</strong> ${emergencyMatch[1]}</p>
                     <p><strong>What they said:</strong> ${lastUserMessage}</p>
                     <p style="color:#666;font-size:13px;">Mely already gave them the emergency contact number. This is just so you know right away too.</p>`,
            }),
          }).catch((e) => console.error("Emergency-report email failed:", e));
        }
      }
    }

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("mely-chat error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
