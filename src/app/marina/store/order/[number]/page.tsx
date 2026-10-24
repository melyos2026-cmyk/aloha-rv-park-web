import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { getMarinaForPage } from "@/lib/marina/company";
import { loadStoreSettings } from "@/lib/marina/data";
import { loadOrderByLink, orderPageUrl } from "@/lib/marina/storeOrders";
import OrderLive from "@/components/marina/OrderLive";

// Oct 24 (per Mely): the customer's order page — like a Walmart pickup order. Big status, the
// order number, a 4-digit pickup code and a QR the counter can scan, and what's in the bag.
// Private: needs the order's link (?t=…). Refreshes itself while the order is open.
export const dynamic = "force-dynamic";
export const metadata = { title: "Your order", robots: { index: false } };

const money = (n: number) => "$" + Number(n || 0).toFixed(2);
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default async function Page({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ t?: string; new?: string; paid?: string }> }) {
  const [{ number }, sp] = await Promise.all([params, searchParams]);
  const company = await getMarinaForPage();
  if (!company) notFound();
  const o = await loadOrderByLink(company.id, decodeURIComponent(number), String(sp.t || ""));
  if (!o) notFound();
  const store = await loadStoreSettings(company.id);
  const slip = o.fulfillment === "slip";
  const qr = await QRCode.toDataURL(orderPageUrl(company.domain, o.order_number, String(sp.t)), { width: 320, margin: 1, color: { dark: "#0f2540", light: "#ffffff" } });

  const step = o.status === "placed" ? 1 : o.status === "ready" ? 2 : o.status === "completed" ? 3 : 0;
  const head =
    o.status === "cancelled" ? { tone: "off", title: "This order was cancelled", sub: `Questions? ${company.contact_phone ? `Call ${company.contact_phone}.` : "Contact the marina office."}` }
    : !o.paid && o.payment === "card" ? { tone: "warn", title: "Payment not finished", sub: "We haven't received the card payment for this order yet. If you were charged, it may take a minute — refresh this page." }
    : o.status === "placed" ? { tone: "prep", title: "We're preparing your order", sub: slip ? `We'll bring it to slip ${o.slip_name}${o.wanted_at ? ` · ${o.wanted_at}` : ""}.` : `We'll let you know when it's ready to pick up${o.wanted_at ? ` · ${o.wanted_at}` : ""}.` }
    : o.status === "ready" ? (slip ? { tone: "ready", title: `On the way to slip ${o.slip_name}`, sub: "Our team is bringing your order to your boat." } : { tone: "ready", title: "Ready for pickup", sub: `Come to the ${store.name} and show your pickup code or QR.` })
    : { tone: "done", title: slip ? `Delivered to slip ${o.slip_name}` : "Picked up — thank you!", sub: `${when(o.completed_at) || ""}${o.completed_at ? ". " : ""}Enjoy your day on the water.` };

  return (
    <div className="mr-wrap mr-order">
      <OrderLive active={o.status === "placed" || o.status === "ready" || (!o.paid && o.payment === "card" && o.status !== "cancelled")} clearCart={sp.new === "1" || sp.paid === "1"} />
      <a href="/marina/store" className="mr-order-back">← {store.name}</a>

      <div className={`mr-order-status ${head.tone}`}>
        <div className="mr-order-status-title">{head.title}</div>
        <div className="mr-order-status-sub">{head.sub}</div>
        {step > 0 && (
          <ol className="mr-order-steps" aria-label="Order progress">
            <li className={step >= 1 ? "on" : ""}><span>1</span>Order received</li>
            <li className={step >= 2 ? "on" : ""}><span>2</span>{slip ? "On the way" : "Ready for pickup"}</li>
            <li className={step >= 3 ? "on" : ""}><span>3</span>{slip ? "Delivered" : "Picked up"}</li>
          </ol>
        )}
      </div>

      <div className="mr-order-grid">
        <section className="mr-order-pass" aria-label="Show this at the counter">
          <div className="mr-order-pass-text">
            <div className="mr-order-label">Order</div>
            <div className="mr-order-number">{o.order_number}</div>
            {o.pickup_code && (<>
              <div className="mr-order-label" style={{ marginTop: 14 }}>{slip ? "Delivery code" : "Pickup code"}</div>
              <div className="mr-order-code">{o.pickup_code}</div>
            </>)}
            <div className="mr-order-name">{o.customer_name}</div>
          </div>
          <img src={qr} alt="Order QR code" className="mr-order-qr" width={160} height={160} />
          <p className="mr-order-hint">{slip ? "If our team asks, show this code." : "Show this screen at the counter — they scan the QR or ask for the code."}</p>
        </section>

        <section className="mr-order-box">
          <div className="mr-order-where">
            <div><div className="mr-order-label">{slip ? "Delivery to" : "Pick up at"}</div><b>{slip ? `Slip ${o.slip_name}` : store.name}</b></div>
            {o.wanted_at && <div><div className="mr-order-label">When</div><b>{o.wanted_at}</b></div>}
            <div><div className="mr-order-label">Ordered</div><b>{when(o.created_at)}</b></div>
          </div>
          {o.notes && <p className="mr-order-notes">“{o.notes}”</p>}
          <ul className="mr-order-items">
            {(o.lines || []).map((l, i) => (
              <li key={i}><span className="q">{l.qty}×</span><span className="n">{l.name}</span><span className="p">{money(l.qty * l.price)}</span></li>
            ))}
          </ul>
          <div className="mr-order-totals">
            {Number(o.tax) > 0 && <div><span>Subtotal</span><span>{money(o.subtotal)}</span></div>}
            {Number(o.tax) > 0 && <div><span>Tax</span><span>{money(o.tax)}</span></div>}
            <div className="t"><span>Total</span><span>{money(o.total)}</span></div>
            <div className="paid">{o.payment === "account" ? "Charged to your boater account" : o.paid ? "Paid by card ✓" : "Card payment not finished"}</div>
          </div>
        </section>
      </div>
      {company.contact_phone && <p className="mr-note" style={{ textAlign: "center", marginTop: 18 }}>Questions about your order? Call <a href={`tel:${company.contact_phone}`}>{company.contact_phone}</a>.</p>}
    </div>
  );
}
