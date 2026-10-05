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
    // Oct 5 (per Mely): free-text notes the park writes in Settings ->
    // "Notes for Mely". Labeled so they read as current office notes; they
    // take priority for temporary changes or announcements.
    const extraInfo = company?.ai_assistant_info
      ? `\n\nNotes from the park's office (written by the park, always current — use them, and if they conflict with older general information above, follow these):\n${company.ai_assistant_info}`
      : "";

    // Sep 25 (per Mely — "necesito que pueda tambien ver la hora"): same
    // live current-date/time fix as admin's Ask Mely — computed fresh
    // server-side on every request (America/New_York), since the model
    // has no built-in sense of "now" otherwise.
    const now = new Date();
    const nowContext = `\n\nRight now it is ${now.toLocaleString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })} (Eastern Time).`;

    // Real lot data — specs, pricing, and current availability — so Mely
    // can actually answer reservation questions instead of only pointing
    // people to the map.
    let lotsContext = "";
    if (company?.id) {
      const { data: lots } = await supabaseAdmin
        .from("rv_lots")
        .select(
          "lot_name, status, max_length_ft, max_width_ft, amp_service, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing, online_booking_disabled"
        )
        .eq("company_id", company.id)
        .order("lot_name", { ascending: true });

      if (lots && lots.length > 0) {
        // Oct 5 (per Mely): quote the monthly rate that applies TODAY, never
        // a season range, and never talk about seasons. Same rule as the
        // map's isDateInSeason: 'MM-DD' dates, wrapping the year-end when
        // start > end.
        const { data: seasonRow } = await supabaseAdmin
          .from("park_settings")
          .select("high_season_start_month_day, high_season_end_month_day")
          .eq("company_id", company.id)
          .maybeSingle();
        const toMD = (v: any) => {
          const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || ""));
          return m ? Number(m[1]) * 100 + Number(m[2]) : null;
        };
        const seasonStart = toMD(seasonRow?.high_season_start_month_day);
        const seasonEnd = toMD(seasonRow?.high_season_end_month_day);
        const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const todayMD = (etNow.getMonth() + 1) * 100 + etNow.getDate();
        const inHighSeason =
          seasonStart != null && seasonEnd != null
            ? seasonStart <= seasonEnd
              ? todayMD >= seasonStart && todayMD <= seasonEnd
              : todayMD >= seasonStart || todayMD <= seasonEnd
            : false;

        // Oct 5 (per Mely — found live: Mely quoted "section S" monthly
        // prices to a visitor asking about Oct 31): S-lots are RV STORAGE
        // only (the map treats any lot whose name starts with "S" as
        // storage), never a place to stay, so they must not appear in the
        // stay-lot list at all. Storage is explained separately below.
        const stayLots = lots.filter((l) => !/^s/i.test(l.lot_name || ""));
        const available = stayLots.filter((l) => l.status === "available" || l.status === "reserved");
        const lotLines = available
          .map((l) => {
            const seasonal =
              l.use_seasonal_pricing !== false &&
              seasonStart != null &&
              seasonEnd != null &&
              l.high_season_price != null &&
              l.low_season_price != null;
            const monthly = `$${seasonal ? (inHighSeason ? l.high_season_price : l.low_season_price) : l.base_price}/month`;
            const parts = [
              `Lot ${l.lot_name}`,
              l.max_length_ft ? `fits up to ${l.max_length_ft}ft` : null,
              l.amp_service ? `${l.amp_service} amp service` : null,
              l.base_price || seasonal ? monthly : null,
              l.daily_rate ? `$${l.daily_rate}/night` : null,
              l.weekly_rate ? `$${l.weekly_rate}/week` : null,
              l.online_booking_disabled
                ? "(shows available, but must be booked by calling the office)"
                : l.status === "reserved"
                ? "(currently reserved, opening up soon)"
                : "(available now)",
            ].filter(Boolean);
            return "- " + parts.join(", ");
          })
          .join("\n");

        lotsContext = `\n\nCurrent lot availability and specs (as of right now):\n${lotLines}\n\nUse this real data to answer questions about lot sizes, pricing, and availability. The monthly price shown is the one that applies today: quote it as simply "the monthly rent right now", and NEVER mention seasons (high season, low season, snowbird season, off-peak, peak) or guess when or whether rent will change. If asked about future rent, say the application shows the exact rent for their lot and move-in date, or the office can confirm. This list is the lots' status right now, not a calendar. The "How stays work" section below says when to send someone to the interactive map on the home page (short reservations, where they pick exact dates) and when to send them to the Apply page (long stays), or they can call the office.`;
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
    // Oct 5 (per Mely): the stay-length line between a short-term
    // reservation and a lease application is the park's own Lease Defaults
    // "background_check_threshold_days" (default 15 — same default the map's
    // BookingModal uses), so it is read here instead of hardcoded.
    let stayThresholdDays = 15;
    // Oct 5 (per Mely — "que mely esté conectada para que dé la info correcta
    // según lo que Aloha ponga en sus settings"): move-in costs — security
    // deposit, pet fee, how a partial first month is billed, and which day
    // rent is due — all read live from the park's own settings.
    let moveInCostContext = "";
    if (company?.id) {
      const { data: parkSettings } = await supabaseAdmin
        .from("park_settings")
        .select("lease_defaults, rent_due_day_policy, rent_due_day_fixed")
        .eq("company_id", company.id)
        .maybeSingle();

      const defaults = parkSettings?.lease_defaults as Record<string, any> | undefined;
      if (defaults) {
        const thresholdFromSettings = Number(defaults.background_check_threshold_days);
        if (thresholdFromSettings > 0) stayThresholdDays = thresholdFromSettings;
        const moveInLines: string[] = [];
        if (defaults.security_deposit_enabled && Number(defaults.security_deposit_amount) > 0) {
          moveInLines.push(
            `Security deposit: $${defaults.security_deposit_amount}, one time, paid at move-in together with the first rent${
              Number(defaults.security_deposit_return_days) > 0
                ? `; refunded within ${defaults.security_deposit_return_days} days after move-out, less any deductions for damages or unpaid charges`
                : ""
            }.`
          );
        } else {
          moveInLines.push("Security deposit: this park does not currently require one.");
        }
        if (Number(defaults.pet_deposit) > 0 && defaults.pets_allowed) {
          moveInLines.push(`Pet fee/deposit: $${defaults.pet_deposit} if the resident has a pet.`);
        }
        moveInLines.push(
          defaults.first_month_proration_method === "daily_rate"
            ? "Partial first month (moving in mid-month): the park charges the lot's nightly rate for each remaining day of that month (for example, moving in on the 31st means 1 night at the lot's nightly rate)."
            : "Partial first month (moving in mid-month): the monthly rent is prorated, which is monthly rent divided by the number of days in that month, times the days remaining including the move-in day (for example, moving in on October 31 means 1 day of October's 31 days)."
        );
        const duePolicy = parkSettings?.rent_due_day_policy;
        moveInLines.push(
          duePolicy === "move_in_anniversary"
            ? "Rent due day: each resident's rent is due on the same day of the month as their move-in day."
            : `Rent due day: rent is due on day ${parkSettings?.rent_due_day_fixed || 1} of every month, so after a partial first month the next full month's rent is due on the next due day.`
        );
        moveInCostContext = `\n\nMove-in costs (from the park's own settings, always current):\n- ${moveInLines.join("\n- ")}`;
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
    // Oct 5 (per Mely — "que Mely esté update con los últimos cambios"):
    // general, non-personal explanation of how applying and the background
    // check work, so applicants can get unstuck without calling the office.
    // Deliberately generic — no fee amounts or thresholds are hardcoded
    // (those are set per park), and the STRICT PRIVACY RULE below still
    // forbids discussing anyone's actual result.
    const applicationContext = `\n\nHow applying and the background check work (general information for applicants):
- Applications are completed online at https://${host}/apply (always give this exact link whenever you tell someone to apply or complete the application). The application fee is paid online at the end of the application.
- Most stays require a background check for every adult on the application. Very short stays may not need one, and the office can confirm for a specific situation.
- Never say the name of the background check company (do not write "Checkr"). Just say "the background check". If the person themselves mentions an email from Checkr or asks whether it is legitimate, confirm that it is the park's real background check and safe to use.
- Right after the fee is paid, each adult gets an email about the background check, sent on behalf of the park. It contains a secure link to fill out their own form. That email can take several minutes to arrive, and it can land in spam or junk, so ask people to check there and wait a little before worrying.
- Each person completes their part on that secure page. The park never sees what they type there.
- If they get a second email saying "Background check paused: more information needed", it means one more thing is needed from them to finish their background check. They should open the link in that email and complete the step before the deadline written in the email. If they are unsure what is being asked, the email and the page explain it, and the office can help them with next steps.
- After the background check is complete, the park's office reviews the application and approves it. Mely cannot approve, deny, or predict the outcome of anyone's application, and never discusses any individual's results.
- If an expected email still has not arrived after about 15 to 20 minutes and spam has been checked, direct the person to the office${phone ? ` at ${phone}` : ""}${email ? ` or ${email}` : ""}.`;
    // Oct 5 (per Mely — found live: asked about Oct 31, Mely said there was
    // "muchísima disponibilidad", quoted storage-lot prices, and never asked
    // how long the stay was): mirrors how the park's own booking system
    // (aloha-rv-park BookingModal) and lease application are built, so
    // Mely follows the same rules instead of improvising them.
    const stayRulesContext = `\n\nHow stays work (follow this exactly — it mirrors how the park's booking system and lease application are built):
- When someone asks about availability, rates, or booking, first find out what kind of stay they want: a few nights, a week or a few weeks, or moving in to live here. Ask how many nights they plan to stay (and their arrival date if they have not said). Ask one short question at a time, then answer based on their reply.
- A stay of ${stayThresholdDays} nights or fewer is a short-term reservation: the person picks the exact lot and exact dates on the interactive map and pays online. Always show this link in your reply: https://${host}/#map The price is built from calendar months first, then whole weeks (only if that lot has a weekly rate), then the remaining nights at the nightly rate.
- A stay longer than ${stayThresholdDays} nights, a month-to-month stay, or a yearly stay is NOT a reservation: the person becomes a resident, so they must complete the lease application (https://${host}/apply, always show this link), which includes a background check, and then pays monthly rent. Never send these stays to the map to book. Quote only the monthly rate for them.
- Costs when moving in: use the "Move-in costs" section. If the person gives an arrival date, explain what they pay at the start: the application fee when applying, then once approved the partial first month (calculate it with the park's method using the lot's rates and say it is an estimate, with the exact amount shown in their application), the security deposit if the park requires one, and then the full monthly rent from the next rent due day. If you do not have the exact figures for their lot, say the application shows the exact total before they pay. Never invent a fee that is not listed.
- When someone wants to live here (or is staying longer than ${stayThresholdDays} nights), always explain the whole process in order, as a short numbered list, with the Apply link: 1. Complete the lease application online and pay the application fee at the end. 2. Each adult on the application gets an email to complete a background check (check spam or junk if it does not arrive). 3. The background check can take a few days to come back. 4. After the background check is done, the park's office reviews the application and approves it, and the person is notified. 5. Once approved, they complete the move-in steps and pay the first charges (partial first month, plus the security deposit if the park requires one, see "Move-in costs"), and then the monthly rent (state the current monthly rate). Make clear that approval depends on passing the background check and the office's approval, and that Mely cannot approve, deny, or predict the outcome. Keep each step to one short sentence.
- If someone is not sure how long they will stay, treat it as a long stay and point them to the Apply page.
- You do NOT have a day-by-day booking calendar. Never promise that a lot is free on a specific date, and never say there is "a lot of availability" for a date. You can say which lots show as available right now, and that the map shows the real open dates once they pick their dates, or they can call the office.`;

    const storageContext = `\n\nRV storage: the S lots (S1 through S6, and any lot whose name starts with S) are RV storage spaces only, never a place to stay or camp. Never list them as lots to stay in and never quote, estimate, or hint at a storage price or availability: the price is agreed directly with the office case by case. Storage is arranged through the office${phone ? ` at ${phone}` : ""}: the office confirms there is a space free and that it fits the person's RV or trailer, and agrees the price with them. After that the office sets up the payment: for a current resident, the storage rent is added to their existing resident account and monthly invoice, and they pay it in the resident portal with their other charges; for someone who is not a resident, the office creates a portal account for them so they can pay their monthly storage rent through the portal. Do not tell people they can reserve or pay for these spaces on the website or map by themselves, and do not tell them they can create their own account.`;

    const systemPrompt = `You are Mely, the friendly, professional AI assistant for ${companyName}${address ? ` located at ${address}` : ""}.${phone ? ` Phone: ${phone}.` : ""}${email ? ` Email: ${email}.` : ""}${nowContext}

${extraInfo}${lotsContext}${pagesContext}${listingsContext}${rulesContext}${moveInCostContext}${applicationContext}${stayRulesContext}${storageContext}

Style: be warm, kind and natural, and never cold or curt. Answer fully and helpfully: give the useful details the person needs (what it is, how it works, what to expect, and the next step), even for simple questions, in a few clear sentences or short paragraphs rather than a one-line reply. Do not pad: no small talk, no filler, no repeating what you already said, and ask at most one question at a time. When someone wants to become a resident, explain every step in order (see "How stays work"), because they need to know what to expect. Do not end with filler offers such as "would you like me to tell you how to get to the page?": just give the link.

Language: always reply in the SAME language the person just wrote in — Spanish, English, or any other language — match their current message, not any previous one in the conversation. Always keep a warm, professional tone regardless of language.

Identity: if someone asks who created you or who built you, say you are Mely, an AI assistant created by MelyOS (melyos.io). Never claim to be a human. If someone sincerely asks whether you are a person or an AI, say you are an AI assistant. If asked what AI model or technology runs behind you, say you don't have those details; never claim MelyOS trained the underlying model.

Formatting: write in clear, separate paragraphs — a blank line between distinct points, never one dense wall of text. This chat only displays plain text, so NEVER use any markdown syntax at all (no **bold**, no - bullets, no # headers, no _italics_, no > blockquotes, no numbered-with-symbols) — every one of those shows up as a literal stray character instead of real formatting. For a list of rules, steps, or facts, number each one on its own line using a plain number and period (1. 2. 3.) AND put a blank line between each numbered item too — never stack them one right under the other with no gap.

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
