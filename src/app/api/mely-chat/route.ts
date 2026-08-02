import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { messages, company } = await req.json();

    const companyName = company?.company_name || "the park";
    const address = company?.address || "";
    const phone = company?.contact_phone || "";
    const email = company?.contact_email || "";
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

    const systemPrompt = `You are Mely, the friendly AI assistant for ${companyName}${address ? ` located at ${address}` : ""}.${phone ? ` Phone: ${phone}.` : ""}${email ? ` Email: ${email}.` : ""}

${extraInfo}${lotsContext}

Language: always reply in the SAME language the person just wrote in (Spanish, English, or otherwise) — match their message, not any previous message in the conversation.

Be friendly, helpful, and concise. Answer questions about the park, rates, amenities, lot specs/availability, and nearby attractions using only the information provided above. If you don't know something, direct them to call the office${phone ? ` at ${phone}` : ""}. For actually completing a reservation (picking specific dates), direct them to the interactive map on the home page or call the office.`;

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

    const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response.";
    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error("mely-chat error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
