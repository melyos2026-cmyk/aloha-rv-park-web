"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; text: string };

export default function MarinaMely({ companyName, demo }: { companyName: string; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);
  const sid = useRef("");

  if (!sid.current && typeof window !== "undefined") {
    try {
      sid.current = sessionStorage.getItem("mely_session_id") || "";
      if (!sid.current) { sid.current = crypto.randomUUID(); sessionStorage.setItem("mely_session_id", sid.current); }
    } catch { sid.current = Math.random().toString(36).slice(2); }
  }

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);
  useEffect(() => {
    const a = setTimeout(() => setTip(true), 2500), b = setTimeout(() => setTip(false), 10000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  useEffect(() => {
    if (!open || greeted.current) return;
    greeted.current = true;
    setTyping(true);
    const t = setTimeout(() => {
      setTyping(false);
      setMsgs([{
        role: "assistant",
        text: demo
          ? "Hi, I'm Mely, the MelyOS assistant. I can tell you what MelyOS does for marinas, how this website works behind the scenes, or get you a quote. What would you like to know?"
          : `Hi, I'm Mely, the assistant for ${companyName}. Ask me about slips, availability, rates or reservations.`,
      }]);
    }, 1400);
    return () => clearTimeout(t);
  }, [open, demo, companyName]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    const next = [...msgs, { role: "user" as const, text: q }];
    setMsgs(next);
    setBusy(true);
    setTyping(true);
    const started = Date.now();
    let reply = "Sorry, something went wrong. Please try again in a moment.";
    try {
      const res = await fetch("/api/marina/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next, sessionId: sid.current }) });
      const data = await res.json().catch(() => ({}));
      if (data.reply) reply = data.reply;
      else reply = `[diagnostic] HTTP ${res.status} ${data.error || ""}`; // TEMP
    } catch (err) { reply = `[diagnostic] network: ${String((err as any)?.message || err)}`; } // TEMP
    const wait = 1500 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setMsgs((m) => [...m, { role: "assistant", text: reply }]);
    setTyping(false);
    setBusy(false);
  }

  const chips = demo ? ["What does MelyOS do for marinas?", "I want a quote", "Does it work for government marinas?"] : [];

  return (
    <>
      {tip && !open && (
        <button type="button" className="mr-chat-tip" onClick={() => { setOpen(true); setTip(false); }}>
          {demo ? "Questions about MelyOS? Ask me." : "Need help with a slip?"}
        </button>
      )}
      <button type="button" className="mr-chat-fab" onClick={() => { setOpen(!open); setTip(false); }} aria-label={open ? "Close chat" : "Chat with Mely"}>
        {open ? "×" : <img src="/marina/mely.jpg" alt="" />}
      </button>
      {open && (
        <div className="mr-chat" role="dialog" aria-label="Chat with Mely">
          <div className="mr-chat-head">
            <img src="/marina/mely.jpg" alt="" />
            <div><b>Mely</b><small>{demo ? "MelyOS assistant" : `${companyName} assistant`}</small></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">×</button>
          </div>
          <div className="mr-chat-body">
            {msgs.map((m, i) => <div key={i} className={`mr-msg ${m.role}`}>{m.text}</div>)}
            {typing && <div className="mr-msg assistant mr-dots"><i /><i /><i /></div>}
            {msgs.length === 1 && !busy && chips.length > 0 && (
              <div className="mr-chat-chips">{chips.map((c) => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
            )}
            <div ref={bottom} />
          </div>
          <form className="mr-chat-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your question" maxLength={1000} />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">Send</button>
          </form>
        </div>
      )}
    </>
  );
}
