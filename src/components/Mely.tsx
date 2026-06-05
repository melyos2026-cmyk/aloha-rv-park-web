"use client";
import { useState, useRef, useEffect } from "react";

type Message = { role: "user" | "assistant"; text: string };

export default function Mely() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! I'm Mely 🌴 Your Aloha RV Park assistant. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are Mely, the friendly AI assistant for Aloha RV Park located at 4648 S. Orange Blossom Trl, Kissimmee, FL 34746. Phone: (689) 252-0567. Email: info@aloharvparkfl.com.

The park is near Orlando, Disney World, Universal Studios, and SeaWorld.

Rates:
- Daily: $40/night
- Weekly: $225/week  
- Monthly Peak (Jan-Apr, Oct-Dec): $750/month
- Monthly Off-Peak (May-Sep): $600/month

Amenities: Pool, Shuffleboard, Fire Pit, Propane Station, RV Storage, Men's & Women's Restrooms & Showers, Laundry 24/7, WiFi, Water, Sewerage, 50/100 Amps available.

Office Hours: Mon-Fri 8AM-5PM, Sat 10AM-3PM, Sun Closed.

Be friendly, helpful, and concise. Answer questions about the park, rates, amenities, and nearby attractions. For reservations direct them to the map on the home page or call the office.`,
          messages: messages.concat({ role: "user", text: userMsg }).map(m => ({
            role: m.role,
            content: m.text
          }))
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response. Please call us at (689) 252-0567.";
      setMessages(m => [...m, { role: "assistant", text: reply }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Sorry, something went wrong. Please call us at (689) 252-0567." }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Chat Button */}
      <button onClick={() => setOpen(!open)} style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 1000,
        width: 60, height: 60, borderRadius: "50%",
        background: "var(--black)", color: "var(--white)",
        border: "3px solid var(--red)", fontSize: 26,
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform 0.2s"
      }}>
        {open ? "✕" : "🌴"}
      </button>

      {/* Chat Window */}
      {open && (
        <div style={{
          position: "fixed", bottom: 96, right: 24, zIndex: 1000,
          width: 360, height: 500,
          background: "var(--white)", borderRadius: 16,
          border: "2px solid var(--black)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden"
        }}>
          {/* Header */}
          <div style={{ background: "var(--black)", color: "var(--white)", padding: "16px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 20 }}>🌴</div>
            <div>
              <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 700, fontSize: 15 }}>Mely</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>Aloha RV Park Assistant</div>
            </div>
            <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                  fontSize: 13, lineHeight: 1.6,
                  background: m.role === "user" ? "var(--black)" : "var(--gray-light)",
                  color: m.role === "user" ? "var(--white)" : "var(--black)",
                  borderBottomRightRadius: m.role === "user" ? 2 : 12,
                  borderBottomLeftRadius: m.role === "assistant" ? 2 : 12,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ background: "var(--gray-light)", padding: "10px 14px", borderRadius: 12, fontSize: 13, color: "var(--gray)" }}>
                  Mely is typing...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask me anything..."
              style={{ flex: 1, border: "1.5px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", fontFamily: "DM Sans, sans-serif" }}
            />
            <button onClick={send} disabled={loading} style={{
              background: "var(--black)", color: "var(--white)",
              border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600
            }}>→</button>
          </div>
        </div>
      )}
    </>
  );
}
