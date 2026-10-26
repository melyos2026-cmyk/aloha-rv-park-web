import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadRequestByLink, requestProgress, quoteExpired, STAY_LABEL } from "@/lib/marina/slipRequests";
import QuoteAnswer from "@/components/marina/QuoteAnswer";
import RequestDocs from "@/components/marina/RequestDocs";

// Oct 26 (per Mely — "Request → Price → Contract → Deposit → Confirmed"): the boater's private
// tracker for a slip request. Shows where it is and the one thing to do next: accept the price,
// sign, pay the deposit. Documents (insurance, registration, ID) can be sent from here too.
export const dynamic = "force-dynamic";
export const metadata = { title: "Your slip request", robots: { index: false } };

const money = (n: number | null | undefined) => (n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");
const STEPS = ["Request sent", "Price", "Contract signed", "Deposit paid", "Confirmed"];

export default async function Page({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const company = await getMarinaForPage();
  if (!company) notFound();
  const t = String(sp.t || "");
  const r = await loadRequestByLink(company.id, decodeURIComponent(number), t);
  if (!r) notFound();
  const [p, docsRes, setting] = await Promise.all([
    requestProgress(company.id, r),
    supabaseAdmin.from("marina_boat_documents").select("id, doc_type, status, review_note").eq("company_id", company.id).eq("request_id", r.id).order("created_at", { ascending: false }),
    supabaseAdmin.from("company_modules").select("enabled").eq("company_id", company.id).eq("module_name", "marina_require_insurance").maybeSingle(),
  ]);
  const docs = docsRes.error ? null : docsRes.data || [];
  const need = [...(setting.data?.enabled === false ? [] : ["insurance"]), "registration"];
  const q = r.quote_details || null;
  const expired = quoteExpired(r);
  const head =
    r.status === "requested" ? { cls: "prep", title: "We're reviewing your request", sub: "The office checks which slip fits your boat best and sends you the price." }
    : r.status === "quoted" && expired ? { cls: "off", title: "Your price expired", sub: `It was valid until ${day(r.quote_expires_at)}. Call the marina to get a new one.` }
    : r.status === "quoted" ? { cls: "prep", title: "Your price is ready", sub: `Slip ${q?.slip_name || p.slip} is held for you until ${day(r.quote_expires_at)}. Accept it below.` }
    : r.status === "quote_accepted" ? { cls: "ready", title: "Thank you! Your contract is on its way", sub: "The office is preparing your contract with this price. We'll email you when it's ready to sign." }
    : r.status === "contract_sent" ? { cls: "prep", title: "Your contract is ready to sign", sub: `Slip ${p.slip} is offered to you. Sign in with ${r.email} to read and sign it.` }
    : r.status === "signed" && !p.depositPaid ? { cls: "prep", title: "Last step: pay the deposit", sub: `Pay ${money(p.depositDue)} in your account to confirm slip ${p.slip}.` }
    : r.status === "confirmed" || p.step >= 4 ? { cls: "ready", title: `Confirmed: slip ${p.slip} is yours`, sub: `From ${day(r.start_date)}. Welcome aboard!` }
    : r.status === "declined" ? { cls: "off", title: "We couldn't offer a slip", sub: r.decline_reason || "" }
    : { cls: "off", title: "This request was cancelled", sub: company.contact_phone ? `Questions? Call ${company.contact_phone}.` : "" };
  const step = r.status === "confirmed" ? 5 : p.step;
  const open = !["declined", "cancelled", "confirmed"].includes(r.status);

  return (
    <div className="mr-wrap mr-order mr-wo">
      <div className={`mr-order-status ${head.cls}`}>
        <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{company.company_name} · Slip request {r.request_number}</div>
        <div className="mr-order-status-title" style={{ marginTop: 4 }}>{head.title}</div>
        <div className="mr-order-status-sub">{head.sub}</div>
        {step > 0 && (
          <ol className="mr-order-steps mr-req-steps" aria-label="Progress">
            {STEPS.map((s, i) => <li key={s} className={i < step ? "on" : ""}><span>{i < step ? "✓" : i + 1}</span>{s}</li>)}
          </ol>
        )}
      </div>

      {r.status === "quoted" && q && !expired && (
        <section className="mr-order-box mr-quote">
          <div className="mr-order-label">Your price</div>
          <table className="mr-pay-lines" style={{ width: "100%", marginTop: 8 }}>
            <tbody>
              <tr><td>Slip {q.slip_name}{q.dock ? ` · ${q.dock}` : ""}<div className="mr-quote-sub">{day(q.start)} to {day(q.end)}</div></td><td style={{ textAlign: "right" }}><b>{money(q.amount)}</b></td></tr>
              {(q.extras || []).map((x: any) => <tr key={x.name}><td>{x.name}</td><td style={{ textAlign: "right" }}>{money(x.total ?? x.amount)}</td></tr>)}
              {q.deposit ? <tr><td>Refundable security deposit</td><td style={{ textAlign: "right" }}>{money(q.deposit)}</td></tr> : null}
              <tr className="mr-quote-total"><td>Total</td><td style={{ textAlign: "right" }}>{money(Number(q.total) + Number(q.deposit || 0))}</td></tr>
            </tbody>
          </table>
          <p className="mr-quote-sub" style={{ marginTop: 8 }}>Paid {q.terms}.</p>
          {q.message && <p className="mr-order-notes">“{q.message}”</p>}
          <QuoteAnswer number={r.request_number} t={t} total={money(Number(q.total) + Number(q.deposit || 0))} />
          <p className="mr-quote-sub" style={{ marginTop: 10 }}>Accepting is not a payment. Next you sign the contract online and pay the deposit to confirm the slip.</p>
        </section>
      )}

      <div className="mr-order-grid">
        <section className="mr-order-box">
          <div className="mr-order-label">Your request</div>
          <div className="mr-order-where" style={{ marginTop: 8 }}>
            <div><div className="mr-order-label">Type</div><b>{STAY_LABEL[r.stay_type]}</b></div>
            <div><div className="mr-order-label">Dates</div><b>{day(r.start_date)} – {day(r.end_date)}</b></div>
            <div><div className="mr-order-label">Boat</div><b>{r.boat_name || "Your boat"}</b><div style={{ fontSize: 13, color: "var(--mr-muted)" }}>{r.boat_length_ft} ft{r.boat_beam_ft ? ` · ${r.boat_beam_ft} ft beam` : ""}{r.boat_draft_ft ? ` · ${r.boat_draft_ft} ft draft` : ""}{r.power_needed ? ` · ${r.power_needed}` : ""}</div></div>
            {p.slip && <div><div className="mr-order-label">Slip</div><b>{p.slip}</b></div>}
          </div>
          {r.notes && <p className="mr-order-notes">“{r.notes}”</p>}
        </section>
        <section className="mr-order-box">
          <div className="mr-order-label">Next step</div>
          {r.status === "requested" && <p>Nothing to do yet. We&apos;ll email you at <b>{r.email}</b> when your price is ready (usually within 1–2 business days).</p>}
          {r.status === "quoted" && !expired && <p>Look at your price above and press <b>Accept</b>.</p>}
          {r.status === "quote_accepted" && <p>Nothing to do right now. Your contract arrives by email at <b>{r.email}</b>.</p>}
          {r.status === "contract_sent" && (<>
            <p>Read and sign your contract online. It shows the price{p.amount ? ` (${money(p.amount)})` : ""}{p.deposit ? ` and a refundable deposit of ${money(p.deposit)}` : ""}.</p>
            {docs && need.some((n) => !docs.some((d: any) => d.doc_type === n && d.status !== "rejected")) && <p><b>Before signing:</b> send your {need.filter((n) => !docs.some((d: any) => d.doc_type === n && d.status !== "rejected")).join(" and ")} below.</p>}
            <a className="mr-btn dark" href="/marina/account">Sign in to sign</a>
          </>)}
          {r.status === "signed" && !p.depositPaid && (<>
            <p>Pay {money(p.depositDue)} to confirm your slip. Card or bank transfer.</p>
            <a className="mr-btn dark" href="/marina/account">Sign in to pay</a>
          </>)}
          {(r.status === "confirmed" || p.depositPaid) && <p>All set. Your invoices, contract and messages are in your account.<br /><a className="mr-btn" style={{ marginTop: 10, display: "inline-block" }} href="/marina/account">Open my account</a></p>}
          {company.contact_phone && <p style={{ marginTop: 14, fontSize: 14, color: "var(--mr-muted)" }}>Questions? Call <a href={`tel:${company.contact_phone}`}>{company.contact_phone}</a>.</p>}
        </section>
      </div>

      {open && docs && (
        <section className="mr-order-box" style={{ marginTop: 16 }}>
          <div className="mr-order-label">Your documents</div>
          <RequestDocs number={r.request_number} t={t} docs={docs as any} need={need} />
        </section>
      )}
    </div>
  );
}
