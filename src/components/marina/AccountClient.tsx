"use client";
import { useCallback, useEffect, useState } from "react";
import ContractsCard from "./ContractsCard";
import MessagesCard from "./MessagesCard";
import MarketplaceCard from "./MarketplaceCard";
import StoreOrdersCard from "./StoreOrdersCard";
import WorkOrdersCard from "./WorkOrdersCard";
import DocumentsCard from "./DocumentsCard";
import PassCard from "./PassCard";
import RequestsCard from "./RequestsCard";
import RentalsCard from "./RentalsCard";
import ConciergeCard from "./ConciergeCard";
import RestaurantCard from "./RestaurantCard";
import PaymentsSummaryCard from "./PaymentsSummaryCard";
import AutopayCard from "./AutopayCard";
import type { AccountData } from "@/lib/marina/data";

type Account = AccountData & { demo: boolean; companyName: string };
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Earliest time the calendar allows (no launches in the past), as "YYYY-MM-DDTHH:MM" local.
const nowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

type SectionId = "home" | "pay" | "boats" | "contracts" | "bookings" | "services" | "messages" | "more";
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" },
  { id: "pay", label: "Payments", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { id: "boats", label: "My boats", icon: "M3 17l2 3h14l2-3zM6 17V9l6-5v13M12 8l6 9" },
  { id: "contracts", label: "Contracts", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" },
  { id: "bookings", label: "Bookings", icon: "M4 5h16v15H4zM4 10h16M9 3v4M15 3v4" },
  { id: "services", label: "Services", icon: "M14 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-3 3-3-3z" },
  { id: "messages", label: "Messages", icon: "M4 5h16v11H8l-4 4z" },
  { id: "more", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];
const MOBILE: SectionId[] = ["home", "pay", "boats", "messages", "more"];
const sectionFor = (h: string): SectionId | null => {
  if (SECTIONS.some((x) => x.id === h)) return h as SectionId;
  if (h === "autopay" || h === "invoices") return "pay";
  if (h === "documents" || h === "launch") return "boats";
  return null;
};
type Summary = { unread: number; lastMsg: { direction: string; subject: string | null; body: string; created_at: string } | null; contracts: { id: string; title: string; status: string }[]; docBoats: { id: string; name: string; needs: { type: string; state: string }[] }[]; work: { number: string; title: string; status: string; link: string | null }[]; requests: { number: string; status: string; stay: string; link: string; boat: string | null }[]; autopay: { ready?: boolean; enabled?: boolean; label?: string | null; failedAt?: string | null; due?: { amount: number; due: string }[] } };
const DOC: Record<string, string> = { insurance: "Insurance", registration: "Registration", id: "ID", survey: "Survey", other: "Document" };
const REQ: Record<string, string> = { requested: "Office reviewing", quoted: "Price ready", quote_accepted: "Contract coming", contract_sent: "Contract ready to sign", signed: "Deposit due", confirmed: "Confirmed", declined: "Not available", cancelled: "Cancelled" };

function Icon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export default function AccountClient() {
  const [acct, setAcct] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [demoCode, setDemoCode] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Oct 21 (per Mely — Dry Stack): "put my boat in the water" request form.
  const [launchFor, setLaunchFor] = useState<string | null>(null);
  const [launchAt, setLaunchAt] = useState("");
  const [returnAt, setReturnAt] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/marina/account", { cache: "no-store" });
    setAcct(res.ok ? await res.json() : null);
    setChecking(false);
  }, []);

  // Oct 26 (per Mely): the account is split into sections with a menu (side menu on a computer,
  // tab bar on a phone). The section lives in the address (#pay, #boats…) so the back button and
  // links from emails work. Old links keep working: #autopay / #invoices → Payments,
  // #documents / #launch → My boats.
  const [section, setSection] = useState<SectionId>("home");
  const [fromLaunch, setFromLaunch] = useState(false);
  useEffect(() => {
    if (!acct || typeof window === "undefined") return;
    const go = () => {
      const h = window.location.hash.replace("#", "");
      const q = new URLSearchParams(window.location.search);
      const sec = sectionFor(h) || (q.get("autopay") || q.get("paid") ? "pay" : "home");
      setSection(sec);
      if (h === "launch") setFromLaunch(true);
      if (h === "launch" || h === "documents" || h === "autopay" || h === "invoices") {
        setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
      } else {
        window.scrollTo({ top: 0 });
      }
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [acct]);
  const open = (id: SectionId) => {
    if (window.location.hash.replace("#", "") === id) { setSection(id); window.scrollTo({ top: 0 }); return; }
    window.location.hash = id;
  };

  // what needs the boater's attention, for Home and the red numbers on the menu
  const [sum, setSum] = useState<Summary | null>(null);
  const loadSum = useCallback(async () => {
    const g = (u: string): Promise<any> => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const [m, c, d, w, r, a] = await Promise.all([g("/api/marina/messages"), g("/api/marina/contracts"), g("/api/marina/documents"), g("/api/marina/work-order"), g("/api/marina/slip-request"), g("/api/marina/autopay")]);
    const msgs = m.messages || [];
    setSum({ unread: m.unread || 0, lastMsg: msgs[msgs.length - 1] || null, contracts: c.contracts || [], docBoats: d.boats || [], work: w.workOrders || [], requests: r.requests || [], autopay: a || {} });
  }, []);
  useEffect(() => { if (acct) loadSum(); }, [acct, section, loadSum]);

  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search).get("paid");
    if (p === "success") setNotice("Payment received. Thank you. It may take a moment to show below.");
    if (p === "cancelled") setNotice("Payment cancelled. You were not charged.");
  }, [load]);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy("code");
    try {
      const d = await post("/api/marina/auth/request", { email });
      setDemoCode(d.demoCode || "");
      setStage("code");
    } catch (err: any) { setError(err.message); }
    setBusy("");
  }

  async function requestLaunch(e: React.FormEvent, boatId: string) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy("l" + boatId);
    try {
      await post("/api/marina/launch", {
        boat_id: boatId,
        launch_at: new Date(launchAt).toISOString(),
        return_at: returnAt ? new Date(returnAt).toISOString() : null,
      });
      setLaunchFor(null);
      setNotice("Request sent. The dock team will have your boat ready.");
      await load();
    } catch (err: any) { setError(err.message); }
    setBusy("");
  }

  async function cancelLaunch(id: string, boatId: string) {
    setError(""); setBusy("l" + boatId);
    const res = await fetch("/api/marina/launch", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setError(d.error || "Could not cancel.");
    else { setNotice("Launch request cancelled."); await load(); }
    setBusy("");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy("verify");
    try {
      await post("/api/marina/auth/verify", { email, code });
      setCode(""); setDemoCode(""); setStage("email");
      await load();
    } catch (err: any) { setError(err.message); }
    setBusy("");
  }

  async function pay(id: string, method: "card" | "ach" = "card") {
    setError(""); setNotice(""); setBusy(id);
    try {
      const d = await post("/api/marina/pay", { invoice_id: id, method });
      if (d.url) { window.location.href = d.url; return; }
      setNotice(method === "ach" ? "Demo bank payment recorded. No bank account was debited." : "Demo payment recorded. No card was charged.");
      await load();
    } catch (err: any) { setError(err.message); }
    setBusy("");
  }

  // Oct 24 (per Mely): "Pay balance" — pay the checked invoices in one payment (one fee).
  const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
  async function payMany(ids: string[], method: "card" | "ach") {
    setError(""); setNotice(""); setBusy("many");
    try {
      const d = await post("/api/marina/pay", { invoice_ids: ids, method });
      if (d.url) { window.location.href = d.url; return; }
      setNotice(`Demo: ${ids.length} invoices paid in one ${method === "ach" ? "bank" : "card"} payment. Nothing was charged.`);
      setUnchecked({});
      await load();
    } catch (err: any) { setError(err.message); }
    setBusy("");
  }

  async function logout() {
    await post("/api/marina/auth/logout", {});
    setAcct(null);
  }

  if (checking) return <div className="mr-acct"><p>Loading…</p></div>;

  if (!acct) {
    return (
      <div className="mr-acct" style={{ maxWidth: 480 }}>
        <h1 className="mr-h2">Boater login</h1>
        <p className="mr-lede">Enter the email your marina has on file. We send a 6-digit code.</p>
        {stage === "email" ? (
          <form className="mr-form" onSubmit={sendCode}>
            <label>Email<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {error && <div className="mr-error" role="alert">{error}</div>}
            <div><button className="mr-btn dark" disabled={busy === "code"}>{busy === "code" ? "Sending…" : "Send my code"}</button></div>
          </form>
        ) : (
          <form className="mr-form" onSubmit={verify}>
            {demoCode ? (
              <div className="mr-code-hint">Demo site: your code is <b>{demoCode}</b></div>
            ) : (
              <p>If that email is on file, a code is on its way. It expires in 10 minutes.</p>
            )}
            <label>6-digit code<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            {error && <div className="mr-error" role="alert">{error}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="mr-btn dark" disabled={busy === "verify" || code.length !== 6}>{busy === "verify" ? "Checking…" : "Sign in"}</button>
              <button type="button" className="mr-btn" onClick={() => { setStage("email"); setError(""); }}>Use another email</button>
            </div>
          </form>
        )}
        {typeof window !== "undefined" && /(^|\.)melyos\.io$/.test(window.location.hostname) && (
          <p className="mr-note">Demo: sign in with <b>boater@marinademo.melyos.io</b>. The code appears on screen.</p>
        )}
      </div>
    );
  }

  const due = acct.invoices.filter((i) => i.balance > 0);
  const payable = due.filter((i) => !(i.pending_bank > 0));
  const picked = payable.filter((i) => !unchecked[i.id]);
  const pickedTotal = Math.round(picked.reduce((a, i) => a + i.balance, 0) * 100) / 100;
  const achOn = !!(acct as any).ach?.enabled; const achMin = Number((acct as any).ach?.min ?? 100);

  // ---- what needs attention (Home list + red numbers on the menu) ----
  const overdue = due.filter((i) => i.overdue);
  const overdueTotal = Math.round(overdue.reduce((a, i) => a + i.balance, 0) * 100) / 100;
  const toSign = (sum?.contracts || []).filter((k) => k.status !== "signed" && k.status !== "void" && k.status !== "cancelled");
  const docTodo = (sum?.docBoats || []).flatMap((b) => b.needs.filter((n) => ["missing", "expired", "rejected", "expiring"].includes(n.state)).map((n) => ({ boat: b.name, ...n })));
  const toApprove = (sum?.work || []).filter((w) => w.status === "awaiting_approval");
  const reqAction = (sum?.requests || []).filter((r) => ["quoted", "contract_sent", "signed"].includes(r.status));
  const apFailed = !!sum?.autopay?.failedAt;
  type Item = { key: string; text: string; sub?: string; tone: "bad" | "warn" | "info"; go: SectionId; href?: string };
  const attention: Item[] = [];
  if (overdue.length) attention.push({ key: "od", text: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`, sub: `${money(overdueTotal)} past due`, tone: "bad", go: "pay" });
  if (apFailed) attention.push({ key: "ap", text: "Autopay could not charge your payment method", sub: "Update it or pay by hand", tone: "bad", go: "pay" });
  for (const k of toSign) attention.push({ key: "k" + k.id, text: "Contract ready to sign", sub: k.title, tone: "warn", go: "contracts" });
  for (const r of reqAction) if (!(r.status === "contract_sent" && toSign.length)) attention.push({ key: "r" + r.number, text: r.status === "quoted" ? "Your slip price is ready" : r.status === "contract_sent" ? "Sign your slip contract" : "Pay your slip deposit", sub: `${r.number}${r.boat ? ` · ${r.boat}` : ""}`, tone: "warn", go: "bookings", href: r.link });
  for (const d of docTodo) attention.push({ key: "d" + d.boat + d.type, text: `${DOC[d.type] || "Document"} ${d.state === "expiring" ? "expires soon" : d.state === "rejected" ? "was sent back" : d.state === "expired" ? "has expired" : "is needed"}`, sub: d.boat, tone: d.state === "expiring" ? "warn" : "bad", go: "boats" });
  for (const w of toApprove) attention.push({ key: "w" + w.number, text: "Service estimate to approve", sub: w.title, tone: "warn", go: "services", href: w.link || undefined });
  if (sum?.unread) attention.push({ key: "m", text: `${sum.unread} new message${sum.unread === 1 ? "" : "s"} from the office`, tone: "info", go: "messages" });

  const badge: Partial<Record<SectionId, number>> = {
    pay: overdue.length + (apFailed ? 1 : 0), boats: docTodo.filter((d) => d.state !== "expiring").length, contracts: toSign.length,
    bookings: reqAction.length, services: toApprove.length, messages: sum?.unread || 0,
  };
  badge.more = (badge.contracts || 0) + (badge.bookings || 0) + (badge.services || 0);
  const Badge = ({ n }: { n?: number }) => (n ? <span className="mr-nav-badge">{n}</span> : null);
  const lastPay = acct.payments[0];
  const title = SECTIONS.find((x) => x.id === section)?.label || "";

  const invoices = (
      <div className="mr-card" id="invoices" style={{ scrollMarginTop: 110 }}>
        <h3>Invoices</h3>
        {due.length > 0 && (acct as any).ach?.enabled && <p className="mr-note" style={{ marginTop: 0 }}>Bank (ACH) payment has a much lower fee than a card and is available on balances of {money((acct as any).ach?.min ?? 100)} or more. It takes 3–5 business days to clear.</p>}
        {payable.length > 1 && (
          <div className="mr-paybal">
            <div>
              <div className="mr-paybal-label">Pay {picked.length === payable.length ? "everything" : `${picked.length} of ${payable.length}`} in one payment</div>
              <div className="mr-paybal-amt">{money(pickedTotal)}</div>
              <div className="mr-note" style={{ margin: 0 }}>Uncheck any invoice you want to pay later. One payment, one receipt per invoice.</div>
            </div>
            <div className="mr-paybal-btns">
              <button className="mr-btn dark" disabled={busy === "many" || picked.length === 0} onClick={() => payMany(picked.map((i) => i.id), "card")}>{busy === "many" ? "Working…" : "Pay by card"}</button>
              {achOn && pickedTotal >= achMin && <button className="mr-btn ghost mr-btn-ink" disabled={busy === "many" || picked.length === 0} onClick={() => payMany(picked.map((i) => i.id), "ach")} title="Lower fee. Takes 3–5 business days to clear.">Pay by bank (ACH)</button>}
            </div>
          </div>
        )}
        {due.length === 0 ? <p className="mr-note">Nothing due. You are all paid up.</p> : due.map((i) => (
          <div className={`mr-inv mr-inv-due${payable.length > 1 ? " many" : ""}`} key={i.id}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
              {payable.length > 1 && !(i.pending_bank > 0) && (
                <input type="checkbox" aria-label={`Include ${i.invoice_number}`} style={{ width: 20, height: 20, marginTop: 3, flex: "0 0 auto", accentColor: "#0f2540" }} checked={!unchecked[i.id]} onChange={(e) => setUnchecked({ ...unchecked, [i.id]: !e.target.checked })} />
              )}
              <div style={{ minWidth: 0 }}>
              {i.description}
              <small>{i.invoice_number} · due {day(i.due_date)} {i.overdue && <span className="mr-overdue">Overdue</span>} · <a href={`/marina/account/invoice/${i.id}`}>View (PDF)</a></small>
              </div>
            </div>
            <div className="mr-inv-actions">
              <span className="mr-money">{money(i.balance)}</span>
              {i.pending_bank > 0 ? (
                <span className="mr-note" style={{ margin: 0 }}>Bank payment of {money(i.pending_bank)} is clearing (3–5 business days)</span>
              ) : (<>
                <button className={payable.length > 1 ? "mr-pay-one" : "mr-btn"} disabled={busy === i.id} onClick={() => pay(i.id, "card")}>{busy === i.id ? "Working…" : payable.length > 1 ? "Pay only this one" : "Pay by card"}</button>
                {payable.length <= 1 && (acct as any).ach?.enabled && i.balance >= ((acct as any).ach?.min ?? 100) && (
                  <button className="mr-btn ghost" disabled={busy === i.id} onClick={() => pay(i.id, "ach")} title="Lower fee. Takes 3–5 business days to clear.">Pay by bank (ACH)</button>
                )}
              </>)}
            </div>
          </div>
        ))}
      </div>
  );
  const boats = (
      <div className="mr-card" id="launch" style={{ scrollMarginTop: 110 }}>
        <h3>My boats</h3>
        {fromLaunch && acct.boats.length > 0 && !acct.boats.some((b) => b.dry) && (
          <p className="mr-note" style={{ marginTop: 0 }}>Dry stack launch is for boats kept on a rack in dry storage. Your boat stays in the water, so there is nothing to request. Ask the office if you would like dry storage.</p>
        )}
        {acct.boats.some((b) => b.dry) && <p className="mr-note" style={{ marginTop: 0 }}>Boats in dry storage: tap the button under the boat you want and the dock team will have it in the water at your time.</p>}
        {acct.boats.length === 0 ? <p className="mr-note">No boats on file.</p> : acct.boats.map((b) => (
          <div key={b.id}>
            <div className="mr-inv">
              <div>{b.boat_name}<small>{[b.make_model, b.length_ft ? `${b.length_ft} ft` : ""].filter(Boolean).join(" · ")}</small></div>
              <span>{b.slip_name ? `${b.dock ? b.dock + " " : ""}${b.dry ? "Rack" : "Slip"} ${b.slip_name}` : "No slip assigned"}</span>
            </div>
            {b.dry && (
              <div style={{ padding: "4px 0 12px" }}>
                {b.launch ? (
                  <div className="mr-ok" role="status" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span>
                      {b.launch.status === "in_water" ? `${b.boat_name} is in the water.` : b.launch.status === "confirmed" ? `${b.boat_name}: launch confirmed` : `${b.boat_name}: launch requested`}
                      {b.launch.status !== "in_water" && ` for ${new Date(b.launch.launch_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
                      {b.launch.return_at && ` · back by ${new Date(b.launch.return_at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`}
                    </span>
                    {b.launch.status !== "in_water" && (
                      <button className="mr-btn ghost" disabled={busy === "l" + b.id} onClick={() => cancelLaunch(b.launch!.id, b.id)}>Cancel request</button>
                    )}
                  </div>
                ) : launchFor === b.id ? (
                  <form onSubmit={(e) => requestLaunch(e, b.id)} style={{ display: "grid", gap: 8 }}>
                    <label className="mr-note" style={{ margin: 0 }}>Put <b>{b.boat_name}</b> in the water at
                      <input type="datetime-local" required min={nowLocal()} value={launchAt} onChange={(e) => setLaunchAt(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
                    </label>
                    <label className="mr-note" style={{ margin: 0 }}>I&apos;ll be back by (optional)
                      <input type="datetime-local" min={launchAt || nowLocal()} value={returnAt} onChange={(e) => setReturnAt(e.target.value)} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="mr-btn" disabled={busy === "l" + b.id}>{busy === "l" + b.id ? "Sending…" : "Send request"}</button>
                      <button type="button" className="mr-btn ghost" onClick={() => setLaunchFor(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button className="mr-btn" onClick={() => { setLaunchFor(b.id); setLaunchAt(""); setReturnAt(""); }}>Put {b.boat_name} in the water</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
  );

  const Tile = ({ go, h, lines, cta = "View all" }: { go: SectionId; h: string; lines: (string | null | false | undefined)[]; cta?: string }) => (
    <button type="button" className="mr-tile" onClick={() => open(go)}>
      <span className="mr-tile-h">{h}<Badge n={badge[go]} /></span>
      {lines.filter(Boolean).map((l, n) => <span key={n} className={n === 0 ? "mr-tile-main" : "mr-tile-line"}>{l}</span>)}
      <span className="mr-tile-cta">{cta} →</span>
    </button>
  );

  return (
    <div className="mr-acct mr-acct-tabs">
      <div className="mr-acct-top">
        <h1 className="mr-h2" style={{ margin: 0 }}>{section === "home" ? `Hello, ${acct.member.full_name.split(" ")[0]}` : title}</h1>
        <button className="mr-btn dark mr-acct-signout" onClick={logout}>Sign out</button>
      </div>

      <nav className="mr-acct-nav" aria-label="My account">
        {SECTIONS.filter((x) => x.id !== "more").map((x) => (
          <button key={x.id} type="button" className={section === x.id ? "on" : ""} onClick={() => open(x.id)} aria-current={section === x.id ? "page" : undefined}>
            <Icon d={x.icon} /><span>{x.label}</span><Badge n={badge[x.id]} />
          </button>
        ))}
        <button type="button" className={section === "more" ? "on" : ""} onClick={() => open("more")}><Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" /><span>Profile & more</span></button>
      </nav>

      <div className="mr-acct-main">
        {notice && <div className="mr-ok" role="status">{notice}</div>}
        {error && <div className="mr-error" role="alert">{error}</div>}

        {section === "home" && (<>
          <div className="mr-balance">
            <div><div>Balance due</div><div className="big">{money(acct.totalDue)}</div>{overdue.length > 0 && <div style={{ color: "#fecaca", fontWeight: 600 }}>{money(overdueTotal)} overdue</div>}</div>
            {acct.demo && <div style={{ maxWidth: 260, color: "#bcd5da" }}>Demo: paying here records a test payment. No card is charged.</div>}
            {payable.length > 0 && <button type="button" className="mr-btn" onClick={() => open("pay")} style={{ alignSelf: "center" }}>{payable.length > 1 ? "Pay balance" : "Pay now"}</button>}
          </div>

          {sum && (attention.length > 0 ? (
            <div className="mr-card mr-attn">
              <h3 style={{ margin: "0 0 6px" }}>Needs your attention</h3>
              {attention.map((a) => {
                const body = (<><span className={`mr-attn-dot ${a.tone}`} /><span className="mr-attn-text"><b>{a.text}</b>{a.sub && <small>{a.sub}</small>}</span><span className="mr-attn-go">→</span></>);
                return a.href ? <a key={a.key} className="mr-attn-row" href={a.href}>{body}</a> : <button key={a.key} type="button" className="mr-attn-row" onClick={() => open(a.go)}>{body}</button>;
              })}
            </div>
          ) : (
            <div className="mr-ok" role="status">You&apos;re all set. Nothing needs your attention right now.</div>
          ))}

          <div className="mr-tiles">
            <Tile go="pay" h="Payments" lines={[
              due.length ? `${money(acct.totalDue)} due · ${due.length} invoice${due.length === 1 ? "" : "s"}` : "All paid up",
              sum?.autopay?.ready && (sum.autopay.enabled ? `Autopay on${sum.autopay.label ? ` · ${sum.autopay.label}` : ""}` : "Autopay off"),
              lastPay && `Last payment ${money(lastPay.amount)} · ${day(lastPay.received_at)}`,
            ]} />
            <Tile go="boats" h="My boats" lines={[
              acct.boats.length ? acct.boats.slice(0, 2).map((b) => b.boat_name).join(", ") + (acct.boats.length > 2 ? ` +${acct.boats.length - 2}` : "") : "No boats on file",
              acct.boats[0]?.slip_name && acct.boats.slice(0, 2).filter((b) => b.slip_name).map((b) => `${b.dry ? "Rack" : "Slip"} ${b.slip_name}`).join(" · "),
              sum && (sum.docBoats.length ? (docTodo.length ? `${docTodo.length} document${docTodo.length === 1 ? "" : "s"} need attention` : "Documents on file") : null),
            ]} />
            <Tile go="messages" h="Messages" cta={sum?.lastMsg ? "Open" : "Write to the office"} lines={[
              sum?.lastMsg ? `${sum.lastMsg.direction === "office" ? (sum.lastMsg.subject || "Marina office") : "You"}` : "No messages yet",
              sum?.lastMsg && `${sum.lastMsg.body.slice(0, 90)}${sum.lastMsg.body.length > 90 ? "…" : ""}`,
            ]} />
            {(sum?.contracts.length || 0) > 0 && <Tile go="contracts" h="Contracts" lines={[toSign.length ? `${toSign.length} to sign` : "All signed", `${sum!.contracts.length} contract${sum!.contracts.length === 1 ? "" : "s"} on file`]} />}
            {(sum?.requests.length || 0) > 0 && <Tile go="bookings" h="Bookings" lines={[`${REQ[sum!.requests[0].status] || sum!.requests[0].status}`, `${sum!.requests[0].stay[0].toUpperCase()}${sum!.requests[0].stay.slice(1)} slip · ${sum!.requests[0].number}`, sum!.requests.length > 1 && `${sum!.requests.length - 1} more`]} />}
            {(sum?.work.length || 0) > 0 && <Tile go="services" h="Service & repairs" lines={[toApprove.length ? `${toApprove.length} estimate${toApprove.length === 1 ? "" : "s"} to approve` : `${sum!.work.filter((w) => !["completed", "invoiced", "declined", "cancelled"].includes(w.status)).length} active job(s)`, sum!.work[0].title]} />}
          </div>

          <PassCard />
        </>)}

        {section === "pay" && (<>
          {acct.demo && <p className="mr-note" style={{ margin: 0 }}>Demo: paying here records a test payment. No card is charged.</p>}
          {invoices}
          <AutopayCard />
          <PaymentsSummaryCard payments={acct.payments} />
        </>)}

        {section === "boats" && (<>
          {boats}
          <DocumentsCard />
          <PassCard />
        </>)}

        {section === "contracts" && (<>
          <ContractsCard fullName={acct.member.full_name} marinaName={acct.companyName || "the Marina"} />
          {sum && !sum.contracts.length && <div className="mr-card"><p className="mr-note" style={{ margin: 0 }}>No contracts yet. When the marina sends you one, you read and sign it here.</p></div>}
        </>)}

        {section === "bookings" && (<>
          <RequestsCard />
          {(acct as any).rentals && <RentalsCard />}
          {(acct as any).restaurant && <RestaurantCard name={(acct as any).restaurant} />}
          <div className="mr-card">
            <h3 style={{ margin: 0 }}>Need a slip?</h3>
            <p className="mr-note" style={{ margin: "4px 0 10px" }}>Book a night or a week, or ask for a monthly, seasonal or annual slip.</p>
            <a className="mr-btn dark" href="/#slips">Find a slip</a>
          </div>
        </>)}

        {section === "services" && (<>
          <WorkOrdersCard />
          <StoreOrdersCard />
          {(acct as any).concierge && <ConciergeCard />}
          {sum && !sum.work.length && !(acct as any).concierge && <div className="mr-card"><p className="mr-note" style={{ margin: 0 }}>No service work yet. Repairs and estimates from the marina show up here for you to approve.</p></div>}
        </>)}

        {section === "messages" && <MessagesCard startOpen />}

        {section === "more" && (<>
          <div className="mr-more-list">
            {(["contracts", "bookings", "services"] as SectionId[]).map((id) => {
              const x = SECTIONS.find((s) => s.id === id)!;
              return <button key={id} type="button" onClick={() => open(id)}><Icon d={x.icon} /><span>{x.label}</span><Badge n={badge[id]} /><span className="mr-attn-go">→</span></button>;
            })}
          </div>
          <div className="mr-card">
            <h3 style={{ margin: 0 }}>My profile</h3>
            <div className="mr-inv"><div>{acct.member.full_name}<small>{acct.member.email || "No email on file"}</small></div></div>
            <p className="mr-note">To change your name, email or phone, write to the office in Messages.</p>
            <button className="mr-btn dark" onClick={logout}>Sign out</button>
          </div>
          <MarketplaceCard />
        </>)}
      </div>

      <nav className="mr-tabbar" aria-label="My account">
        {MOBILE.map((id) => {
          const x = SECTIONS.find((s) => s.id === id)!;
          const on = section === id || (id === "more" && ["contracts", "bookings", "services", "more"].includes(section));
          return <button key={id} type="button" className={on ? "on" : ""} onClick={() => open(id)}><Icon d={x.icon} /><span>{x.label}</span><Badge n={badge[id]} /></button>;
        })}
      </nav>
    </div>
  );
}
