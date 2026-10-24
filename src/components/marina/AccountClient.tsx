"use client";
import { useCallback, useEffect, useState } from "react";
import ContractsCard from "./ContractsCard";
import MessagesCard from "./MessagesCard";
import MarketplaceCard from "./MarketplaceCard";
import StoreOrdersCard from "./StoreOrdersCard";
import RentalsCard from "./RentalsCard";
import ConciergeCard from "./ConciergeCard";
import RestaurantCard from "./RestaurantCard";
import PaymentsSummaryCard from "./PaymentsSummaryCard";
import type { AccountData } from "@/lib/marina/data";

type Account = AccountData & { demo: boolean; companyName: string };
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Earliest time the calendar allows (no launches in the past), as "YYYY-MM-DDTHH:MM" local.
const nowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

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

  // Oct 21 (per Mely): "Dry stack launch" in the menu opens /marina/account#launch,
  // so jump straight to the boats card once the account has loaded.
  const [fromLaunch, setFromLaunch] = useState(false);
  useEffect(() => {
    if (!acct || typeof window === "undefined") return;
    const go = () => {
      if (window.location.hash !== "#launch") return;
      setFromLaunch(true);
      setTimeout(() => document.getElementById("launch")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [acct]);

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
  return (
    <div className="mr-acct">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 className="mr-h2" style={{ margin: 0 }}>Hello, {acct.member.full_name.split(" ")[0]}</h1>
        <button className="mr-btn dark" onClick={logout}>Sign out</button>
      </div>
      {notice && <div className="mr-ok" role="status">{notice}</div>}
      {error && <div className="mr-error" role="alert">{error}</div>}
      <div className="mr-balance">
        <div><div>Balance due</div><div className="big">{money(acct.totalDue)}</div></div>
        {acct.demo && <div style={{ maxWidth: 260, color: "#bcd5da" }}>Demo: paying here records a test payment. No card is charged.</div>}
        {payable.length > 0 && <a className="mr-btn" href="#invoices" style={{ alignSelf: "center" }}>{payable.length > 1 ? "Pay balance" : "Pay now"}</a>}
      </div>

      <MessagesCard />

      <ContractsCard fullName={acct.member.full_name} marinaName={acct.companyName || "the Marina"} />

      <StoreOrdersCard />

      {(acct as any).rentals && <RentalsCard />}

      {(acct as any).concierge && <ConciergeCard />}
      {(acct as any).restaurant && <RestaurantCard name={(acct as any).restaurant} />}

      <MarketplaceCard />

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

      <PaymentsSummaryCard payments={acct.payments} />
    </div>
  );
}
