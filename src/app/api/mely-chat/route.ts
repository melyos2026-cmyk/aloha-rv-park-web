import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { hostnameFromRequest } from "@/lib/marina/host";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // Oct 26 (security review): each message costs an AI call — at most 30 per device per hour.
    if (await tooManyFromIp(req, "mely-chat", 30)) {
      return NextResponse.json({ error: "You've sent a lot of messages. Please wait a bit, or call the office." }, { status: 429 });
    }
    const body = await req.json();
    const sessionId = body?.sessionId;
    // Oct 20 (security review): the browser sends the whole conversation
    // on every turn, so it was unbounded (cost/abuse) and could include
    // made-up "assistant" turns of any size. Keep only well-formed
    // user/assistant turns, only the most recent MAX_HISTORY of them, cap
    // each one's length, and make sure the conversation ends with the
    // visitor's own message. The widget's real history is far smaller
    // than these limits, so normal chats are unaffected.
    const MAX_HISTORY = 20;
    const MAX_USER_CHARS = 2000;
    const MAX_ASSISTANT_CHARS = 4000;
    const rawMessages: any[] = Array.isArray(body?.messages) ? body.messages : [];
    let messages: { role: "user" | "assistant"; text: string }[] = rawMessages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role,
        text: m.text.slice(0, m.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS),
      }));
    while (messages.length && messages[messages.length - 1].role !== "user") messages = messages.slice(0, -1);
    if (!messages.length || !messages[messages.length - 1].text.trim()) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    // SECURITY: never trust a `company` object sent by the client for DB
    // scoping — that would let anyone POST an arbitrary company.id/park_id
    // and pull another tenant's private website content, listings, or lot
    // pricing (cross-tenant leak). Always re-derive the company server-side
    // from the request's own Host header, the same way pages/[slug] does.
    // Oct 26 (security review): same host rule as the rest of the site (local dev / previews use
    // NEXT_PUBLIC_DEV_COMPANY_DOMAIN), and no company for this host → 404 (no AI call on a
    // domain that isn't one of our parks/marinas).
    const host = hostnameFromRequest(req);
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select(
        "id, company_name, address, contact_email, contact_phone, emergency_phone, ai_assistant_info, park_id, is_demo, domain"
      )
      .eq("domain", host)
      .maybeSingle();
    if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });

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
          "id, lot_name, status, reserved_until, max_length_ft, max_width_ft, amp_service, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing, online_booking_disabled"
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
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        const mdLabel = (v: any) => {
          const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(v || ""));
          return m ? `${monthNames[Number(m[1]) - 1]} ${Number(m[2])}` : "";
        };
        const highFrom = mdLabel(seasonRow?.high_season_start_month_day);
        const highTo = mdLabel(seasonRow?.high_season_end_month_day);
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
            const nowPrice = seasonal ? (inHighSeason ? l.high_season_price : l.low_season_price) : l.base_price;
            // Oct 5 (per Mely): lets Mely answer "how much will rent be in
            // April?" from the park's own Lots & Seasonal Pricing, by the
            // move-in date, without ever using season wording.
            const monthly =
              seasonal && highFrom && highTo && l.high_season_price !== l.low_season_price
                ? `$${nowPrice}/month today (monthly rent by move-in date: $${l.high_season_price} for move-ins from ${highFrom} through ${highTo}, and $${l.low_season_price} for all other dates)`
                : `$${nowPrice}/month`;
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

        // Oct 21 (per Mely — "ella sabe el calendario de reservaciones"): the real
        // booked date ranges of every stay lot for the next 6 months (the same
        // ranges the map blocks), so Mely can say which lots are open for given
        // dates. Only dates, never who booked.
        const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const horizon = new Date(Date.now() + 183 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        const calendarLines = await Promise.all(
          stayLots.map(async (l: any) => {
            if (l.status === "occupied") {
              return `- Lot ${l.lot_name}: occupied by a resident${l.reserved_until ? `, expected to open on ${l.reserved_until}` : ", no open dates known"}`;
            }
            if (l.status !== "available" && l.status !== "reserved") return `- Lot ${l.lot_name}: not available (${String(l.status || "").replace(/_/g, " ")})`;
            const { data: ranges } = await supabaseAdmin.rpc("get_lot_blocked_ranges", { p_lot_id: l.id });
            const booked = (ranges || [])
              .map((r: any) => ({ a: String(r.range_start).slice(0, 10), b: String(r.range_end).slice(0, 10) }))
              .filter((r: any) => r.b >= todayISO && r.a <= horizon)
              .sort((x: any, y: any) => x.a.localeCompare(y.a));
            return `- Lot ${l.lot_name}: ${booked.length ? `booked ${booked.map((r: any) => `${r.a} to ${r.b}`).join("; ")}; every other date is open` : "no bookings, every date is open"}`;
          })
        );
        const calendarContext = `\n\nBooking calendar for the next 6 months (today is ${todayISO}; dates are YYYY-MM-DD; a booking from A to B means arrival on A and departure on B, so B is free again for a new arrival):\n${calendarLines.join("\n")}\n\nUse this calendar to answer which lots are open for the dates someone asks about: a lot is open for a stay if none of its booked ranges overlap the stay. Name the open lots with their prices. Say the dates are confirmed when they pick them on the interactive map. Never say who booked a lot or anything about another guest.`;

        lotsContext = `\n\nCurrent lot availability and specs (as of right now):\n${lotLines}${calendarContext}\n\nUse this real data to answer questions about lot sizes, pricing, and availability. The monthly price shown is the one that applies today: quote it as simply "the monthly rent right now", and NEVER use the words season, high season, low season, snowbird, off-peak or peak. If someone asks about the rent on a future date, use the "monthly rent by move-in date" schedule shown for that lot: the rent depends on the move-in date, so quote the figure for their date and say the application shows the exact amount for their lot and move-in date. If a lot shows no schedule, the monthly rent is the same all year; never guess that it will change. This list is the lots' status right now, not a calendar. The "How stays work" section below says when to send someone to the interactive map on the home page (short reservations, where they pick exact dates) and when to send them to the Apply page (long stays), or they can call the office.`;
      }
    }

    // Oct 5 (per Mely — "los horarios de la piscina están en el mapa, en el
    // emoji del nadador"): the info popups on the interactive map's icons
    // (pool, office, laundry, etc.: title + info lines such as hours) are
    // stored in map_elements (type "emojis"). Read live so Mely always
    // matches what the admin typed on the map, with no code changes.
    let amenitiesContext = "";
    if (company?.park_id) {
      const { data: emojiRows } = await supabaseAdmin
        .from("map_elements")
        .select("data")
        .eq("park_id", company.park_id)
        .eq("element_type", "emojis")
        .order("id", { ascending: false })
        .limit(1);
      const items = Array.isArray(emojiRows?.[0]?.data) ? emojiRows![0].data : [];
      const amenityLines = items
        .filter((it: any) => (it?.label && String(it.label).trim()) || (it?.info && String(it.info).trim()))
        .map((it: any) => {
          const title = String(it.label || "").trim() || "Map icon";
          const info = String(it.info || "")
            .split("\n")
            .map((x: string) => x.trim())
            .filter(Boolean)
            .join("; ");
          return `- ${title}${info ? `: ${info}` : ""}`;
        })
        .join("\n");
      // Text labels the park placed on the map (e.g. "Dog Park", "Entrance").
      const { data: textRows } = await supabaseAdmin
        .from("map_elements")
        .select("data")
        .eq("park_id", company.park_id)
        .eq("element_type", "texts")
        .order("id", { ascending: false })
        .limit(1);
      const textItems = Array.isArray(textRows?.[0]?.data) ? textRows![0].data : [];
      const textLabels = Array.from(
        new Set(textItems.map((t: any) => String(t?.text || "").trim()).filter(Boolean))
      ).join(", ");

      // Details the park entered per lot on the map (description, size,
      // electricity). Storage lots (S...) are skipped on purpose: storage
      // prices and availability are never quoted, see the storage rules.
      const { data: lotInfoRows } = await supabaseAdmin
        .from("lot_info")
        .select("*")
        .eq("park_id", company.park_id);
      const lotInfoLines = (lotInfoRows || [])
        .filter((r: any) => r?.lot_key && !/^s/i.test(String(r.lot_key)))
        .map((r: any) => {
          const bits = [
            r.description ? String(r.description).trim() : null,
            r.size ? `size ${r.size}` : null,
            r.has_electricity ? `electricity${r.amperage ? ` ${r.amperage} amp` : ""}` : null,
          ].filter(Boolean);
          return bits.length ? `- Lot ${r.lot_key}: ${bits.join("; ")}` : "";
        })
        .filter(Boolean)
        .join("\n");

      // Propane prices shown on the site/map.
      let propaneLines = "";
      if (company?.id) {
        const { data: propane } = await supabaseAdmin
          .from("propane_pricing")
          .select("label, price, unit, taxable, tax_mode")
          .eq("company_id", company.id)
          .order("product_id");
        // Oct 19 (per Mely — new propane prices): read live every time, with
        // the same sales-tax rule the checkout uses.
        const taxNote = (r: any) =>
          r.tax_mode === "excluded" || (!r.tax_mode && r.taxable)
            ? " plus sales tax"
            : r.tax_mode === "included"
            ? " (tax included)"
            : "";
        propaneLines = (propane || [])
          .filter((r: any) => r?.label && r.price != null)
          .map((r: any) => `- ${r.label}: $${Number(r.price).toFixed(2)}${r.unit ? ` per ${r.unit}` : ""}${taxNote(r)}`)
          .join("\n");
      }

      const sections: string[] = [];
      if (amenityLines) sections.push(`Map icons (title and info the park typed, such as hours, rules and prices):\n${amenityLines}`);
      if (textLabels) sections.push(`Text labels placed on the map: ${textLabels}`);
      if (lotInfoLines) sections.push(`Details the park entered for individual lots on the map:\n${lotInfoLines}`);
      if (propaneLines) sections.push(`Propane prices (these are REFILL prices):\n${propaneLines}`);
      if (sections.length > 0) {
        amenitiesContext = `\n\nEverything on the park's interactive map (entered by the park, always current):\n${sections.join("\n\n")}\n\nUse this to answer questions about the pool, office, laundry, propane and other amenities, including their hours, and about individual lots.`;
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
    let checkTimesContext = "";
    if (company?.id) {
      const { data: parkSettings } = await supabaseAdmin
        .from("park_settings")
        .select("lease_defaults, rent_due_day_policy, rent_due_day_fixed")
        .eq("company_id", company.id)
        .maybeSingle();

      const defaults = parkSettings?.lease_defaults as Record<string, any> | undefined;
      if (defaults) {
        // Oct 19 (per Mely): check-in / check-out times, live from Lease Defaults.
        const fmt12 = (t: string) => {
          const m = /^(\d{1,2}):(\d{2})/.exec(t);
          if (!m) return t;
          const h = Number(m[1]);
          return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
        };
        const ci = fmt12(String(defaults.check_in_time || "16:00"));
        const co = fmt12(String(defaults.check_out_time || "11:00"));
        checkTimesContext = `\n\nCheck-in and check-out (set by the park, always current): check-in time is ${ci} and check-out time is ${co}. Give these exact times when someone asks when they can arrive or must leave.`;
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
        // Oct 19 (per Mely): late fee policy, read live from Lease Defaults
        // Only describe it once the park has chosen how often it repeats
        if (defaults.late_fee_enabled !== false && Number(defaults.late_fee_amount) > 0 && defaults.late_fee_frequency) {
          const amt = `$${Number(defaults.late_fee_amount).toFixed(2)}`;
          const freq = defaults.late_fee_frequency;
          const grace = Number(defaults.late_fee_grace_days) || 0;
          const days = String(defaults.late_fee_charge_days || "").split(/[^0-9]+/).filter(Boolean).join(", ");
          moveInLines.push(
            freq === "days_of_month" && days
              ? `Late fee: ${amt} is added on day(s) ${days} of each month while rent is still unpaid, and it keeps adding up until the balance is paid.`
              : freq === "weekly"
              ? `Late fee: ${amt} for each week rent stays unpaid${grace ? `, starting after a ${grace}-day grace period` : ""}.`
              : freq === "one_time"
              ? `Late fee: a one-time ${amt} if rent is not paid${grace ? ` within ${grace} day(s) after the due date` : " by the due date"}.`
              : `Late fee: ${amt} for each day rent stays unpaid${grace ? ` after a ${grace}-day grace period` : ""}.`
          );
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
- If an expected email still has not arrived after about 15 to 20 minutes and spam has been checked, direct the person to the office${phone ? ` at ${phone}` : ""}${email ? ` or ${email}` : ""}.
- What the application asks for (so people can have it ready): name, email, phone, date of birth, driver's license number and a photo of the license, Social Security number, current address, an emergency contact (name, phone and relationship), employer information (employer, address, phone, how long they have worked there, and their manager or supervisor; retired or not currently employed people can check a box instead), income and how often they are paid (weekly, biweekly or monthly), and, only if it applies, the company that pays for their housing. Every adult who will live there is listed too, with their date of birth, email, phone, driver's license and photo, and Social Security number. They also list their vehicles and their RV details, and, if they have pets, each pet's type, name, breed, color, weight, and whether they have shots records.
- Social Security numbers are stored securely; park staff only see the last 4 digits. Never ask anyone to type their Social Security number or any other sensitive number in this chat; it only goes in the application form.
- At the end of the application there is a Collection and Credit Reporting Disclosure: if an amount owed becomes past due, the park may share the person's information with collection and credit reporting agencies, following Florida and federal debt collection laws. If someone asks, explain it simply and suggest they read it on the form; do not give legal advice.
- Pets: the application and the resident portal show the park's list of breeds that are not allowed (see the pet policy above). If someone asks about a specific breed, check that list and answer from it, and suggest they confirm with the office if they are unsure. Residents can update their pets (including shots records) in the resident portal under Parking and Pets, "Edit Pets", and the office is notified.
- Residents who add a household member 18 or older in the resident portal (Household Occupants) must enter that person's email and Social Security number there; it is stored securely and the office only sees the last 4 digits.
- Golf carts: all golf carts must be insured and driven only by a person with a valid driver's license. The application asks whether they will have a golf cart and, if so, its make, model, year, color, serial or tag (optional), insurance company, policy number, insurance expiration date, and a copy of the insurance (photo or PDF). Residents can add or update their golf cart and upload renewed insurance in the resident portal (Golf Cart card); the office is notified.
- Autopay (resident portal): residents can save a card to pay their monthly invoice automatically. Before saving the card they read and accept a short authorization for the monthly automatic charge; they can turn autopay off anytime in the portal (that stops future automatic charges but does not cancel what they owe). The card is stored securely by the payment processor, not by the park.
- Lease addenda (resident portal): the park may send a resident a short addendum to their current rental agreement, for example "Lease Addendum — Returned Payments" (it adds the park's returned-payment clause; everything else in their agreement stays the same). The resident gets an email with a "Review and sign" button, and while it is waiting a "Please review and sign" card shows at the top of the resident portal Home. They open it, read the full text, check "I have read and agree", type their full name exactly as the park has it on file, and press Sign addendum. The office is notified, and the signed copy (PDF) is saved in the portal under Documents, where they can view or download it anytime (it cannot be deleted). For questions about what the addendum means for them, they should contact the office before signing.
- Text messages: the park only sends text messages (invoices, payment notices, application invitations, reservation confirmations — never marketing) to people who agreed. To sign up, check the optional box on the Text Message Alerts page (/text-messages), on the rental application next to the phone number, or in the resident portal under Resident Information → "Text message alerts" (they can turn it off there too). Reply STOP to any text to stop, HELP for help. Message and data rates may apply. Agreeing is never required to rent or reserve. Right after signing up they get one welcome text confirming it. Text alerts are being activated: if someone signed up and has not received texts yet, that is expected for now — they will start automatically, and email notices keep working in the meantime.
- Electricity for metered lots: the office reads each lot's meter once a month and the kWh used is calculated from the meter numbers (whatever kind of meter it is). The electric charge then appears on the resident's invoice, and residents can see each month's kWh, meter numbers and charge in the resident portal (Electric History). For a question about a specific reading or charge, the resident should contact the office.
- Payment at the end of the application is online. Paying in person at the office is only available when the office set that up for the person; otherwise, if someone cannot pay online, direct them to the office.`;
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
- Dates: use the "Booking calendar" above to say which lots are open for the dates the person gives (short stays), and for long stays which lots are available now or when an occupied lot is expected to open. Always add that the exact dates are confirmed when they pick them on the interactive map (short stays) or in the application (long stays). Never say there is "a lot of availability" in general; name the open lots.`;

    // Oct 21 (per Mely): on a demo website Mely knows it is a demo of the MelyOS
    // platform and sends people who want this for their own park to MelyOS.
    const isDemoSite = !!company && ((company as any).is_demo === true || /(^|\.)melyos\.io$/i.test(String((company as any).domain || "")));
    const demoContext = !isDemoSite ? "" : `\n\nThis website is a LIVE DEMO of the MelyOS platform. ${companyName} is a sample park created to show what MelyOS does; it is not a real park, nobody can actually stay here, and online payments are turned off. Answer questions about the demo park normally (lots, prices, the booking calendar, how applications work) so visitors see how you would help their own guests, and mention once, naturally, that this is a demo.

The visitor is most likely an RV park, campground or mobile home park owner or manager. You are MelyOS's star salesperson (per Mely, the founder): confident, enthusiastic, concrete, never "I don't know" or "I can't help" (if a detail is not in your notes, say the team sets that up for them and will cover it in their quote, and keep going). Sell the benefits with examples from this very website: the interactive map where every lot is a clickable shape on the real aerial photo with its photo, size, power, price and availability, and guests reserve right on the map; more online sales 24/7 (reservations, store, propane, rentals, concierge, restaurant tables); less office work (invoices, late fees, meter readings, autopay, statements, daily close and collections run themselves); applications with background checks and leases signed online; a resident portal with one login for everything; messages and notices; marketplace; careers page; QuickBooks export; and an AI assistant like you for every park. Every feature is a module the park turns on or off in its admin depending on how it runs its business, and ALL of it is included in one plan with no add-ons and no long-term contract; we have not seen anyone combine all of this in one system (never invent facts about a named competitor). Say MelyOS pricing is very competitive and usually pays for itself, but NEVER state, estimate or hint at a number: the team prepares a custom quote. Invite them to try things here (tap a lot and reserve, open the resident portal demo), then ask for their name, email, park name and number of lots so the MelyOS team can send a quote; tell them to use the Request a quote / contact form or email info@melyos.io.
What MelyOS is: a software platform, built in Florida by MelyOS LLC, that runs RV parks, campgrounds and marinas from one place: the park's own website with an interactive map where guests pick their exact lot and dates and pay online, online lease applications with background checks, a resident portal (invoices, autopay, documents, electric usage), the office admin (lots and pricing, reservations, applications, invoices, payments, reports), propane and storage sales, and an AI assistant like you that knows the park and answers in any language. MelyOS sets everything up for each park and adapts to whatever the park needs.
If someone asks how to get this for their own park, about the platform, or about prices: say MelyOS gives each business a custom estimate based on its size and needs (never state, estimate or hint at a price), and that they can learn more at https://melyos.io or write to info@melyos.io for pricing, an estimate or a live walkthrough. Always include info@melyos.io in that answer.`;

    const storageContext = `\n\nRV storage: the S lots (S1 through S6, and any lot whose name starts with S) are RV storage spaces only, never a place to stay or camp. Never list them as lots to stay in and never quote, estimate, or hint at a storage price or availability: the price is agreed directly with the office case by case. Storage is arranged through the office${phone ? ` at ${phone}` : ""}: the office confirms there is a space free and that it fits the person's RV or trailer, and agrees the price with them. After that the office sets up the payment: for a current resident, the storage rent is added to their existing resident account and monthly invoice, and they pay it in the resident portal with their other charges; for someone who is not a resident, the office creates a portal account for them so they can pay their monthly storage rent through the portal. Do not tell people they can reserve or pay for these spaces on the website or map by themselves, and do not tell them they can create their own account.`;

    // Oct 5 (per Mely): office hours, the same ones shown in the website
    // footer (src/components/Footer.tsx — if the footer hours change, change
    // them here too; a "Notes for Mely" entry also overrides this).
    // This route serves every company, so these Aloha-specific facts are only
    // included for Aloha (other parks use their own Notes for Mely).
    const isAloha = company?.park_id === "aloha";
    const officeHoursContext = !isAloha ? "" : `\n\nOffice hours (Eastern Time): Monday to Friday 10:00 AM to 5:00 PM, Saturday 10:00 AM to 3:00 PM, Sunday closed. Anything that needs the office (propane refills, storage, questions) happens during these hours. If someone asks when they can come, call, or get something done, give these hours and use the current date and time above to say whether the office is open right now.`;

    const propaneRulesContext = !isAloha ? "" : `\n\nPropane: the park only REFILLS propane tanks that people bring themselves. It does not sell tanks and it does not have a self-serve propane station. Refills are done during office hours. When someone asks about propane, give the refill price for their tank size from the data above, say they bring their own tank to be refilled, and give the office hours. Never say the park sells tanks or that they can pick one up. If a propane price written in a map icon differs from the "Propane prices" list, always use the "Propane prices" list (it is the official, current price the checkout charges).`;

    const laundryContext = !isAloha ? "" : `\n\nLaundry: a wash costs $2.00 and a dry costs $1.50. The machines accept quarters only (no bills, cards or other coins). Anyone who needs change for quarters can get it at the office during office hours.`;

    const systemPrompt = `You are Mely, the friendly, professional AI assistant for ${companyName}${address ? ` located at ${address}` : ""}.${phone ? ` Phone: ${phone}.` : ""}${email ? ` Email: ${email}.` : ""}${nowContext}

${demoContext}${extraInfo}${lotsContext}${amenitiesContext}${pagesContext}${listingsContext}${officeHoursContext}${propaneRulesContext}${laundryContext}${rulesContext}${moveInCostContext}${applicationContext}${stayRulesContext}${checkTimesContext}${storageContext}

Style: be warm, kind and natural, and never cold or curt. Answer fully and helpfully: give the useful details the person needs (what it is, how it works, what to expect, and the next step), even for simple questions, in a few clear sentences or short paragraphs rather than a one-line reply. Do not pad: no small talk, no filler, no repeating what you already said, and ask at most one question at a time. When someone wants to become a resident, explain every step in order (see "How stays work"), because they need to know what to expect. Do not end with filler offers such as "would you like me to tell you how to get to the page?": just give the link.

TEAM AND REVIEWS (per Mely, applies to every company): you are part of the ${companyName} team, not an outsider. Always speak warmly and proudly about the staff, using "our team" / "our office staff". If anyone asks how the office staff, the office lady, the manager or the team are doing, or what they are like, say they are doing great and that the team is friendly, attentive and very service-oriented, always happy to help every resident and guest. Never say you don't know them, never invent personal details (health, schedules, private life) and never name or criticize any staff member. If someone mentions bad Google reviews, complaints or a bad experience: do not argue and do not discuss specific reviews (you cannot see them). Thank them for sharing, say you understand their concern and that every experience matters, say our team works hard every day to help each person and always takes feedback seriously to keep improving, then invite them to contact the office or the manager directly so we can make it right (give the office phone/email if you have it). Keep it short, kind and positive.

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
        model: "claude-sonnet-5-5",
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
              // Oct 20 (security review): visitor text is escaped before going into the HTML email.
              html: `<p><strong>Someone reported a park-equipment emergency</strong> through the Mely chat widget on your website.</p>
                     <p><strong>Summary:</strong> ${escapeHtml(emergencyMatch[1])}</p>
                     <p><strong>What they said:</strong> ${escapeHtml(lastUserMessage)}</p>
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

// Oct 20 (security review): used for visitor text placed in staff emails.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
