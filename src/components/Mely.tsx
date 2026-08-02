"use client";
import { useState, useRef, useEffect } from "react";
import { useCompany } from "@/lib/CompanyContext";

type Message = { role: "user" | "assistant"; text: string };

export default function Mely() {
  const { company } = useCompany();
  const companyName = company?.company_name || "Aloha RV Park";
  const phone = company?.contact_phone || "(689) 252-0567";

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const greetedRef = useRef(false);
  const MIN_TYPING_MS = 3000;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showTyping]);

  useEffect(() => {
    const showTimer = setTimeout(() => setShowTooltip(true), 2000);
    const hideTimer = setTimeout(() => setShowTooltip(false), 9000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  // Show the typing indicator for a bit before the greeting appears —
  // like a real person composing a reply — instead of it being there
  // instantly. Only happens once, the first time the widget opens.
  useEffect(() => {
    if (!open || greetedRef.current) return;
    greetedRef.current = true;
    setShowTyping(true);
    const timer = setTimeout(() => {
      setShowTyping(false);
      setMessages([
        { role: "assistant", text: `Hi! I'm Mely 🌺 Your ${companyName} assistant. How can I help you today?` },
      ]);
    }, MIN_TYPING_MS);
    return () => clearTimeout(timer);
  }, [open, companyName]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const nextMessages = [...messages, { role: "user" as const, text: userMsg }];
    setMessages(nextMessages);
    setLoading(true);
    setShowTyping(true);
    const startedAt = Date.now();

    try {
      const res = await fetch("/api/mely-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, company }),
      });
      const data = await res.json();
      const reply = data.reply || `Sorry, I couldn't get a response. Please call us at ${phone}.`;

      // Keep the typing indicator up for at least MIN_TYPING_MS total, so
      // a fast reply doesn't feel instant/robotic — like a real person
      // taking a moment to type.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_TYPING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_TYPING_MS - elapsed));
      }

      setMessages(m => [...m, { role: "assistant", text: reply }]);
    } catch {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_TYPING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_TYPING_MS - elapsed));
      }
      setMessages(m => [...m, { role: "assistant", text: `Sorry, something went wrong. Please call us at ${phone}.` }]);
    }
    setShowTyping(false);
    setLoading(false);
  };

  return (
    <>
      {showTooltip && !open && (
        <div
          onClick={() => { setOpen(true); setShowTooltip(false); }}
          style={{
            position: "fixed", bottom: 94, right: 24, zIndex: 999,
            background: "var(--sea)", color: "var(--black)",
            padding: "12px 16px", borderRadius: 12, maxWidth: 220,
            fontSize: 13, fontWeight: 600, boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            border: "2px solid var(--white)", cursor: "pointer",
            fontFamily: "DM Sans, sans-serif"
          }}
        >
          Aloha! Need any help?
        </div>
      )}

      <button onClick={() => { setOpen(!open); setShowTooltip(false); }} style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 1000,
        width: 60, height: 60, borderRadius: "50%",
        background: open ? "var(--sea)" : "var(--white)",
        color: "var(--black)",
        border: "3px solid var(--white)", fontSize: 22,
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", padding: 0,
        transition: "transform 0.2s"
      }}>
        {open ? "✕" : (
          <img src="/mely-avatar.jpeg" alt="Mely" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
        )}
      </button>

      {open && (
        <div style={{
          position: "fixed", bottom: 96, right: 24, zIndex: 1000,
          width: 360, height: 500,
          background: "var(--white)", borderRadius: 16,
          border: "2px solid var(--red)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden"
        }}>
          <div style={{ background: "var(--sea)", color: "var(--black)", padding: "16px 20px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 20 }}>🌺</div>
            <div>
              <div style={{ fontFamily: "Playfair Display, serif", fontWeight: 700, fontSize: 15 }}>Mely</div>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>{companyName} Assistant</div>
            </div>
            <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                  fontSize: 13, lineHeight: 1.6,
                  background: m.role === "user" ? "var(--sea)" : "var(--gray-light)",
                  color: "var(--black)",
                  borderBottomRightRadius: m.role === "user" ? 2 : 12,
                  borderBottomLeftRadius: m.role === "assistant" ? 2 : 12,
                }}>
                  {m.text}
                </div>
              </div>
            ))}
            {showTyping && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ background: "var(--gray-light)", padding: "10px 14px", borderRadius: 12, display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gray)", animation: "melyTypingBounce 1.4s infinite ease-in-out", animationDelay: "0ms" }} />
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gray)", animation: "melyTypingBounce 1.4s infinite ease-in-out", animationDelay: "150ms" }} />
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gray)", animation: "melyTypingBounce 1.4s infinite ease-in-out", animationDelay: "300ms" }} />
                </div>
                <style>{`
                  @keyframes melyTypingBounce {
                    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
                    30% { transform: translateY(-4px); opacity: 1; }
                  }
                `}</style>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask me anything..."
              style={{ flex: 1, border: "1.5px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 13, outline: "none", fontFamily: "DM Sans, sans-serif" }}
            />
            <button onClick={send} disabled={loading} style={{
              background: "#d1f6e0", color: "var(--red-dark)",
              border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600
            }}>→</button>
          </div>
        </div>
      )}
    </>
  );
}
