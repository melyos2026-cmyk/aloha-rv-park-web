import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadRequestByLink, requestProgress, STAY_LABEL } from "@/lib/marina/slipRequests";

// Oct 26 (per Mely — "Request → Quote → Contract → Deposit → Confirmed"): the boater's private
// tracker for a slip request. Shows where it is and the one thing to do next.
export const dynamic = "force-dynamic";
export const metadata = { title: "Your slip request", robots: { index: false } };

const money = (n: number | null | undefined) => (n == null ? "" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "");
const STEPS = ["Request sent", "Contract & price", "Signed", "Deposit paid", "Confirmed"];

export default async function Page({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const company = await getMarinaForPage();
  if (!company) notFound();
  const r = await loadRequestByLink(company.id, decodeURIComponent(number), String(sp.t || ""));
  if (!r) notFound();
  const p = await requestProgress(company.id, r);
  const head =
    r.status === "requested" ? { cls: "prep", title: "We're reviewing your request", sub: "The office checks which slip fits your boat best and sends you a contract with the price." }
    : r.status === "contract_sent" ? { cls: "prep", title: "Your contract is ready to sign", sub: `Slip ${p.slip} is offered to you. Sign in with ${r.email} to read and sign it.` }
    : r.status === "signed" && !p.depositPaid ? { cls: "prep", title: "Last step: pay the deposit", sub: `Pay ${money(p.depositDue)} in your account to confirm slip ${p.slip}.` }
    : r.status === "confirmed" || p.step >= 4 ? { cls: "ready", title: `Confirmed — slip ${p.slip} is yours`, sub: `From ${day(r.start_date)}. Welcome aboard!` }
    : r.status === "declined" ? { cls: "off", title: "We couldn't offer a slip", sub: r.decline_reason || "" }
    : { cls: "off", title: "This request was cancelled", sub: company.contact_phone ? `Questions? Call ${company.contact_phone}.` : "" };
  const step = r.status === "confirmed" ? 5 : p.step;

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
          {r.status === "requested" && <p>Nothing to do yet. We&apos;ll email you at <b>{r.email}</b> when your contract is ready (usually within 1–2 business days).</p>}
          {r.status === "contract_sent" && (<>
            <p>Read and sign your contract online. It shows the price{p.amount ? ` (${money(p.amount)})` : ""}{p.deposit ? ` and a refundable deposit of ${money(p.deposit)}` : ""}.</p>
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
    </div>
  );
}
