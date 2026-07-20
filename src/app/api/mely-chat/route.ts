import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages, company } = await req.json();

    const companyName = company?.company_name || "the park";
    const address = company?.address || "";
    const phone = company?.contact_phone || "";
    const email = company?.contact_email || "";
    const extraInfo = company?.ai_assistant_info || "";

    const systemPrompt = `You are Mely, the friendly AI assistant for ${companyName}${address ? ` located at ${address}` : ""}.${phone ? ` Phone: ${phone}.` : ""}${email ? ` Email: ${email}.` : ""}

${extraInfo}

Be friendly, helpful, and concise. Answer questions about the park, rates, amenities, and nearby attractions using only the information provided above. If you don't know something, direct them to call the office${phone ? ` at ${phone}` : ""}. For reservations direct them to the map on the home page or call the office.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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
