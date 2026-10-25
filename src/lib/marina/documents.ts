import Stripe from "stripe";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaSession } from "./session";
import { round2 } from "./data";

// Oct 23 (per Mely): printable receipts and invoices for boaters, so months later they still
// know exactly what they paid for: the marina's name, what was bought (item by item for store
// orders), how it was paid (card brand and last 4 when it was a card), and the totals.

export type DocLine = { name: string; qty: number; price: number; total: number };
export type MarinaDoc = {
  kind: "receipt" | "invoice";
  number: string;            // invoice number (receipt shows "Receipt for <invoice>")
  date: string;              // payment date (receipt) or issue date (invoice)
  dueDate: string | null;
  billedTo: { name: string; email: string | null };
  description: string;
  lines: DocLine[];
  subtotal: number; tax: number; total: number;
  paidThis: number | null;   // this payment (receipt)
  paidTotal: number;         // all payments on the invoice
  balance: number;
  method: string | null;     // "Visa •••• 4242", "Cash", "Charged to account"…
  reference: string | null;
  status: "paid" | "open" | "void";
  orderNumber: string | null;
  fulfillment: string | null;
};

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const METHOD: Record<string, string> = { cash: "Cash", check: "Check", card: "Card", ach: "Bank transfer (ACH)", money_order: "Money order", other: "Other" };

async function cardLabel(reference: string | null): Promise<string | null> {
  if (!reference) return null;
  if (reference.startsWith("demo:")) return "Card (demo, not charged)";
  const m = reference.match(/(cs_[A-Za-z0-9_]+)/);
  if (!m || !stripe) return null;
  try {
    const s = await stripe.checkout.sessions.retrieve(m[1], { expand: ["payment_intent.latest_charge"] });
    const ch: any = (s.payment_intent as any)?.latest_charge;
    const card = ch?.payment_method_details?.card;
    if (card?.last4) return `${String(card.brand || "Card").replace(/^\w/, (c: string) => c.toUpperCase())} •••• ${card.last4}`;
  } catch {}
  return null;
}

// Who is signed in on this marina's website (server components).
export async function currentBoater(companyId: string): Promise<string | null> {
  const h = await headers();
  const s = await getMarinaSession(new Request("https://x/", { headers: { cookie: h.get("cookie") || "" } }));
  return s && s.companyId === companyId ? s.memberId : null;
}

export async function loadMarinaDoc(companyId: string, memberId: string, ref: { paymentId?: string; invoiceId?: string }): Promise<MarinaDoc | null> {
  let payment: any = null;
  let invoiceId = ref.invoiceId || "";
  if (ref.paymentId) {
    const { data } = await supabaseAdmin.from("marina_invoice_payments").select("id, invoice_id, amount, method, reference, received_at, returned_at").eq("id", ref.paymentId).eq("company_id", companyId).maybeSingle();
    if (!data || data.returned_at) return null;
    payment = data; invoiceId = data.invoice_id;
  }
  const { data: inv } = await supabaseAdmin.from("marina_invoices")
    .select("id, invoice_number, category, description, amount, issue_date, due_date, status, member_id, customer_name, customer_email")
    .eq("id", invoiceId).eq("company_id", companyId).eq("member_id", memberId).maybeSingle();
  if (!inv) return null;  // only the boater's own documents
  const { data: member } = await supabaseAdmin.from("marina_members").select("full_name, email").eq("id", memberId).eq("company_id", companyId).maybeSingle();
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("amount, returned_at").eq("company_id", companyId).eq("invoice_id", inv.id);
  const paidTotal = round2((pays || []).filter((p: any) => !p.returned_at).reduce((a: number, p: any) => a + Number(p.amount), 0));
  const total = round2(Number(inv.amount));

  // Store orders: item by item.
  let lines: DocLine[] = [], subtotal = total, tax = 0, orderNumber: string | null = null, fulfillment: string | null = null, accountCharge = false;
  if (inv.category === "store") {
    const { data: o } = await supabaseAdmin.from("marina_store_orders").select("order_number, lines, subtotal, tax, fulfillment, slip_name, payment").eq("company_id", companyId).eq("invoice_id", inv.id).maybeSingle();
    if (o) {
      lines = ((o.lines || []) as any[]).map((l) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), total: round2(Number(l.qty) * Number(l.price)) }));
      subtotal = Number(o.subtotal); tax = Number(o.tax); orderNumber = o.order_number;
      fulfillment = o.fulfillment === "slip" ? `Delivered to slip ${o.slip_name || ""}`.trim() : "Picked up at the store";
      accountCharge = o.payment === "account";
    } else {
      const { data: sale } = await supabaseAdmin.from("marina_store_sales").select("lines, subtotal, tax").eq("company_id", companyId).eq("invoice_id", inv.id).maybeSingle();
      if (sale) {
        lines = ((sale.lines || []) as any[]).map((l) => ({ name: l.name, qty: Number(l.qty), price: Number(l.price), total: round2(Number(l.qty) * Number(l.price)) }));
        subtotal = Number(sale.subtotal); tax = Number(sale.tax);
      }
    }
  }
  if (!lines.length) lines = [{ name: inv.description || "Charge", qty: 1, price: total, total }];

  let method: string | null = null;
  if (payment) method = payment.method === "card" ? (await cardLabel(payment.reference)) || "Card" : METHOD[payment.method] || payment.method;
  else if (accountCharge) method = "Charged to your account";

  const balance = inv.status === "void" ? 0 : round2(Math.max(total - paidTotal, 0));
  return {
    kind: payment ? "receipt" : "invoice",
    number: inv.invoice_number,
    date: payment ? payment.received_at : inv.issue_date,
    dueDate: payment ? null : inv.due_date,
    billedTo: { name: member?.full_name || inv.customer_name || "", email: member?.email || inv.customer_email || null },
    description: inv.description || "",
    lines, subtotal: round2(subtotal), tax: round2(tax), total,
    paidThis: payment ? round2(Number(payment.amount)) : null,
    paidTotal, balance, method,
    reference: payment?.reference?.startsWith("online:") ? "Paid online" : payment?.reference && !payment.reference.startsWith("demo:") ? payment.reference : null,
    status: inv.status === "void" ? "void" : balance <= 0 ? "paid" : "open",
    orderNumber, fulfillment,
  };
}
