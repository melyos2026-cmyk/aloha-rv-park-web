import type { MarinaDoc } from "@/lib/marina/documents";
import type { MarinaCompany } from "@/lib/marina/company";
import PrintButton from "./PrintButton";

// Oct 23 (per Mely): a clean receipt / invoice page the boater can print or save as PDF.
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: string | null) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "");

export default function MarinaDocView({ doc, company }: { doc: MarinaDoc; company: MarinaCompany }) {
  const isReceipt = doc.kind === "receipt";
  return (
    <div className="mr-doc-page">
      <div className="mr-doc-actions">
        <a className="mr-btn ghost" href="/marina/account#history">← Back to my account</a>
        <PrintButton />
      </div>
      <article className="mr-doc">
        <header className="mr-doc-head">
          <div>
            {company.logo_url ? <img src={company.logo_url} alt="" className="mr-doc-logo" /> : null}
            <div className="mr-doc-co">{company.company_name}</div>
            {company.address && <div className="mr-doc-muted">{company.address}</div>}
            <div className="mr-doc-muted">{[company.contact_phone, company.contact_email].filter(Boolean).join(" · ")}</div>
            <div className="mr-doc-muted">{company.domain}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mr-doc-title">{isReceipt ? "Payment receipt" : "Invoice"}</div>
            <div className="mr-doc-muted">{isReceipt ? "For invoice" : "Invoice"} <b>{doc.number}</b></div>
            {doc.orderNumber && <div className="mr-doc-muted">Order <b>{doc.orderNumber}</b></div>}
            <div className="mr-doc-muted">{isReceipt ? "Paid on" : "Issued"} {day(doc.date)}</div>
            {!isReceipt && doc.dueDate && <div className="mr-doc-muted">Due {day(doc.dueDate)}</div>}
            <div className={`mr-doc-stamp ${doc.status}`}>{doc.status === "paid" ? "PAID" : doc.status === "void" ? "VOID" : "OPEN"}</div>
          </div>
        </header>

        <section className="mr-doc-to">
          <div className="mr-doc-label">Billed to</div>
          <div><b>{doc.billedTo.name}</b></div>
          {doc.billedTo.email && <div className="mr-doc-muted">{doc.billedTo.email}</div>}
        </section>

        {doc.description && <p className="mr-doc-desc">{doc.description}</p>}

        <table className="mr-doc-table">
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}><td>{l.name}</td><td className="num">{l.qty}</td><td className="num">{money(l.price)}</td><td className="num">{money(l.total)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="mr-doc-totals">
          {doc.tax > 0 && <><div>Subtotal</div><div className="num">{money(doc.subtotal)}</div><div>Sales tax</div><div className="num">{money(doc.tax)}</div></>}
          <div><b>Total</b></div><div className="num"><b>{money(doc.total)}</b></div>
          {isReceipt && doc.paidThis !== null && <><div>Paid on this receipt</div><div className="num">{money(doc.paidThis)}</div></>}
          {!isReceipt && doc.paidTotal > 0 && <><div>Paid</div><div className="num">{money(doc.paidTotal)}</div></>}
          <div>Balance</div><div className="num">{money(doc.balance)}</div>
        </div>

        <section className="mr-doc-pay">
          {doc.method && <div><span className="mr-doc-label">Payment method</span> {doc.method}</div>}
          {doc.reference && <div><span className="mr-doc-label">Reference</span> {doc.reference}</div>}
          {doc.fulfillment && <div><span className="mr-doc-label">Delivery</span> {doc.fulfillment}</div>}
        </section>

        <footer className="mr-doc-foot">Thank you for choosing {company.company_name}. Questions about this {isReceipt ? "receipt" : "invoice"}? Contact the marina office.</footer>
      </article>
    </div>
  );
}
