import { notFound } from "next/navigation";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadWorkOrderByLink } from "@/lib/marina/workOrders";
import WorkOrderApprove from "@/components/marina/WorkOrderApprove";

// Oct 26 (per Mely — work orders): the boat owner's estimate page. Private link (?t=…) sent by
// the marina by email and in Boater login. Shows the job, every labor/part line, photos, the total,
// and lets the owner approve (types their name) or decline with a reason.
export const dynamic = "force-dynamic";
export const metadata = { title: "Work order estimate", robots: { index: false } };

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "");
const KIND: Record<string, string> = { labor: "Labor", part: "Part", fee: "Fee" };

export default async function Page({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const company = await getMarinaForPage();
  if (!company) notFound();
  const wo = await loadWorkOrderByLink(company.id, decodeURIComponent(number), String(sp.t || ""));
  if (!wo) notFound();
  const t = wo.totals;
  const head =
    wo.status === "awaiting_approval" ? { cls: "prep", title: "Your approval is needed", sub: "Review the work and the price below. We start as soon as you approve." }
    : wo.status === "declined" ? { cls: "off", title: "You declined this estimate", sub: wo.declined_reason ? `Reason: “${wo.declined_reason}”. The marina will contact you.` : "The marina will contact you." }
    : wo.status === "cancelled" ? { cls: "off", title: "This work order was cancelled", sub: company.contact_phone ? `Questions? Call ${company.contact_phone}.` : "" }
    : wo.status === "invoiced" ? { cls: "done", title: "Work finished — invoice ready", sub: "Pay it in your account (Boater login)." }
    : wo.status === "completed" ? { cls: "ready", title: "The work is finished", sub: "The invoice will be in your account shortly." }
    : wo.status === "in_progress" || wo.status === "waiting_parts" ? { cls: "ready", title: wo.status === "waiting_parts" ? "Waiting for parts" : "Work in progress", sub: `Approved by ${wo.approved_by_name || "you"}.` }
    : { cls: "ready", title: "Approved — thank you!", sub: `Approved by ${wo.approved_by_name || "you"}. We'll keep you posted.` };
  const step = ["awaiting_approval", "draft", "declined"].includes(wo.status) ? 1 : ["approved"].includes(wo.status) ? 2 : ["in_progress", "waiting_parts"].includes(wo.status) ? 3 : ["completed", "invoiced"].includes(wo.status) ? 4 : 0;

  return (
    <div className="mr-wrap mr-order mr-wo">
      <div className={`mr-order-status ${head.cls}`}>
        <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{company.company_name} · Service · {wo.number}</div>
        <div className="mr-order-status-title" style={{ marginTop: 4 }}>{head.title}</div>
        <div className="mr-order-status-sub">{head.sub}</div>
        {step > 0 && (
          <ol className="mr-order-steps mr-wo-steps" aria-label="Progress">
            <li className={step >= 1 ? "on" : ""}><span>1</span>Estimate</li>
            <li className={step >= 2 ? "on" : ""}><span>2</span>Approved</li>
            <li className={step >= 3 ? "on" : ""}><span>3</span>In the shop</li>
            <li className={step >= 4 ? "on" : ""}><span>4</span>Done</li>
          </ol>
        )}
      </div>

      <div className="mr-order-grid">
        <section className="mr-order-box">
          <div className="mr-order-label">The job</div>
          <h1 style={{ fontSize: 24, margin: "4px 0 2px", color: "var(--mr-ink)" }}>{wo.title}</h1>
          <div style={{ color: "var(--mr-muted)" }}>{wo.category}</div>
          <div className="mr-order-where" style={{ marginTop: 12 }}>
            {wo.boat && <div><div className="mr-order-label">Boat</div><b>{wo.boat.boat_name}</b>{wo.boat.make_model ? <div style={{ fontSize: 13, color: "var(--mr-muted)" }}>{wo.boat.make_model}{wo.boat.length_ft ? ` · ${wo.boat.length_ft} ft` : ""}</div> : null}</div>}
            {wo.slip && <div><div className="mr-order-label">Slip</div><b>{wo.slip}</b></div>}
            {wo.scheduled_start && <div><div className="mr-order-label">Planned</div><b>{day(wo.scheduled_start)}{wo.scheduled_end && wo.scheduled_end !== wo.scheduled_start ? ` – ${day(wo.scheduled_end)}` : ""}</b></div>}
            {wo.due_date && <div><div className="mr-order-label">Ready by</div><b>{day(wo.due_date)}</b></div>}
          </div>
          {wo.description && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, marginTop: 12 }}>{wo.description}</p>}
          {wo.customer_notes && <p className="mr-order-notes">{wo.customer_notes}</p>}
          {wo.photos.length > 0 && (
            <div className="mr-wo-photos">
              {wo.photos.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.label || "Photo"} />{p.label && <span>{p.label}</span>}</a>
              ))}
            </div>
          )}
        </section>

        <section className="mr-order-box">
          <div className="mr-order-label">Estimate</div>
          <ul className="mr-order-items">
            {wo.lines.map((l, i) => (
              <li key={i}><span className="q" style={{ fontSize: 11, textTransform: "uppercase", color: "var(--mr-muted)" }}>{KIND[l.kind]}</span><span className="n">{l.description}<br /><small style={{ color: "var(--mr-muted)" }}>{l.qty} {l.kind === "labor" ? `hr${l.qty === 1 ? "" : "s"}` : "×"} {money(l.unit_price)}</small></span><span className="p">{money(l.amount)}</span></li>
            ))}
          </ul>
          <div className="mr-order-totals">
            {t.labor > 0 && <div><span>Labor</span><span>{money(t.labor)}</span></div>}
            {t.parts > 0 && <div><span>Parts</span><span>{money(t.parts)}</span></div>}
            {t.fees > 0 && <div><span>Fees</span><span>{money(t.fees)}</span></div>}
            {t.shopFee > 0 && <div><span>Shop supplies</span><span>{money(t.shopFee)}</span></div>}
            {t.tax > 0 && <div><span>Sales tax</span><span>{money(t.tax)}</span></div>}
            <div className="t"><span>Total</span><span>{money(t.total)}</span></div>
          </div>
          {wo.status === "awaiting_approval" ? (
            <WorkOrderApprove number={wo.number} token={String(sp.t)} total={money(t.total)} owner={wo.owner || ""} />
          ) : wo.approved_at ? (
            <p style={{ marginTop: 14, color: "#0b6b4f", fontWeight: 700 }}>✓ Approved by {wo.approved_by_name} on {new Date(wo.approved_at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}</p>
          ) : null}
          {wo.status === "invoiced" && <a href="/marina/account" className="mr-btn dark" style={{ marginTop: 14, display: "inline-block" }}>Pay in my account</a>}
          {company.contact_phone && <p style={{ marginTop: 14, fontSize: 14, color: "var(--mr-muted)" }}>Questions about this estimate? Call <a href={`tel:${company.contact_phone}`}>{company.contact_phone}</a>.</p>}
        </section>
      </div>
    </div>
  );
}
