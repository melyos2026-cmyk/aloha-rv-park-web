import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDemoDomain } from "./host";

// Oct 24 (per Mely): online store orders, Walmart-style pickup. Each order has a private link
// (order page + QR code) and a 4-digit pickup code. The customer gets an email when the order is
// confirmed; the admin sends "ready" / "on the way" emails when the store updates the order.

const resend = new Resend(process.env.RESEND_API_KEY);
const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
const money = (n: number) => "$" + Number(n || 0).toFixed(2);

export function newOrderSecrets() {
  return { access_token: crypto.randomBytes(12).toString("hex"), pickup_code: String(crypto.randomInt(0, 10000)).padStart(4, "0") };
}
export const orderPageUrl = (domain: string, number: string, token: string) => `https://${domain}/marina/store/order/${encodeURIComponent(number)}?t=${encodeURIComponent(token)}`;
export const orderQrUrl = (domain: string, number: string, token: string) => `https://${domain}/api/marina/store/order/qr?n=${encodeURIComponent(number)}&t=${encodeURIComponent(token)}`;

export function sameToken(a: string | null | undefined, b: string | null | undefined) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

export type StoreOrder = {
  id: string; order_number: string; access_token: string | null; pickup_code: string | null; invoice_id: string | null;
  customer_name: string; customer_email: string | null; customer_phone: string | null;
  lines: { name: string; qty: number; price: number }[]; subtotal: number; tax: number; total: number;
  fulfillment: "pickup" | "slip"; slip_name: string | null; wanted_at: string | null; notes: string | null;
  payment: "card" | "account"; status: "placed" | "ready" | "completed" | "cancelled";
  created_at: string; ready_at?: string | null; completed_at?: string | null;
};

// The order behind a private link (company + number + token must all match), with whether it is paid.
export async function loadOrderByLink(companyId: string, number: string, token: string): Promise<(StoreOrder & { paid: boolean }) | null> {
  const { data, error } = await supabaseAdmin.from("marina_store_orders").select("*").eq("company_id", companyId).eq("order_number", number).maybeSingle();
  const o: any = error ? null : data;
  if (!o || !sameToken(o.access_token, token)) return null;
  let paid = o.payment === "account";
  if (!paid && o.invoice_id) {
    const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("amount, returned_at").eq("company_id", companyId).eq("invoice_id", o.invoice_id);
    paid = (pays || []).filter((p: any) => !p.returned_at).reduce((a: number, p: any) => a + Number(p.amount), 0) >= Number(o.total) - 0.005;
  }
  return { ...o, paid };
}

// Same sender rule as the admin (lib/emailFrom.ts): the marina's own domain only if verified for sending.
function fromFor(name: string, domain: string) {
  const verified = (process.env.PARK_EMAIL_DOMAINS || "aloharvparkfl.com").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const n = String(name || "").replace(/[<>"\r\n]/g, "").trim() || "Ship Store";
  const d = String(domain || "").toLowerCase().replace(/^(www|admin)\./, "");
  return verified.includes(d) ? `${n} <noreply@${d}>` : `${n} via MelyOS <${process.env.MELYOS_FROM_ADDRESS || "noreply@melyos.io"}>`;
}

export function storeOrderEmailHtml(o: StoreOrder, company: { company_name: string; domain: string; contact_phone?: string | null }, storeName: string) {
  const link = o.access_token ? orderPageUrl(company.domain, o.order_number, o.access_token) : `https://${company.domain}/marina/store`;
  const qr = o.access_token ? orderQrUrl(company.domain, o.order_number, o.access_token) : "";
  const where = o.fulfillment === "slip" ? `Delivered to slip <b>${esc(o.slip_name)}</b>` : `Pick up at the <b>${esc(storeName)}</b>`;
  const rows = (o.lines || []).map((l) => `<tr><td style="padding:6px 0;font-weight:bold;width:44px;vertical-align:top">${Number(l.qty)} ×</td><td style="padding:6px 0">${esc(l.name)}</td><td style="padding:6px 0;text-align:right;white-space:nowrap">${money(l.qty * l.price)}</td></tr>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#0f2540">
    <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">${esc(company.company_name)} · ${esc(storeName)}</div>
    <h2 style="margin:6px 0 4px">Order confirmed</h2>
    <p style="margin:0 0 16px;color:#334155">Hi ${esc(o.customer_name)}, thank you! We&apos;re preparing your order and we&apos;ll email you when it&apos;s ${o.fulfillment === "slip" ? "on the way" : "ready"}.</p>
    <table role="presentation" width="100%" style="border:2px solid #0f2540;border-radius:12px;border-collapse:separate;padding:14px"><tr>
      <td style="vertical-align:middle">
        <div style="font-size:12px;color:#64748b">ORDER</div><div style="font-size:20px;font-weight:bold">${esc(o.order_number)}</div>
        ${o.pickup_code ? `<div style="font-size:12px;color:#64748b;margin-top:10px">PICKUP CODE</div><div style="font-size:34px;font-weight:bold;letter-spacing:.18em">${esc(o.pickup_code)}</div>` : ""}
      </td>
      ${qr ? `<td style="width:132px;text-align:right;vertical-align:middle"><img src="${qr}" width="124" height="124" alt="Order QR code" style="display:inline-block"/></td>` : ""}
    </tr></table>
    <p style="margin:14px 0 4px;color:#334155">${where}${o.wanted_at ? ` · <b>${esc(o.wanted_at)}</b>` : ""}</p>
    <p style="margin:0 0 14px;color:#64748b;font-size:13px">Show this email (the code or the QR) at the counter${o.fulfillment === "slip" ? " if we ask" : ""}.</p>
    <table role="presentation" width="100%" style="border-top:1px solid #e2e8f0;border-collapse:collapse;font-size:15px">${rows}
      ${Number(o.tax) ? `<tr><td></td><td style="padding:6px 0;color:#64748b">Tax</td><td style="padding:6px 0;text-align:right;color:#64748b">${money(o.tax)}</td></tr>` : ""}
      <tr><td></td><td style="padding:8px 0;border-top:1px solid #e2e8f0;font-weight:bold">Total ${o.payment === "account" ? "(charged to your account)" : "(paid)"}</td><td style="padding:8px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:bold">${money(o.total)}</td></tr>
    </table>
    <p style="margin:18px 0"><a href="${link}" style="display:inline-block;background:#0f2540;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">See my order</a></p>
    ${company.contact_phone ? `<p style="color:#64748b;font-size:13px">Questions? Call ${esc(company.contact_phone)}.</p>` : ""}
  </div>`;
}

// Sends the "order confirmed" email once (demo marinas never email). Call when the order is
// charged to the account, or when its card payment is recorded.
export async function sendStoreOrderConfirmation(companyId: string, orderId: string) {
  const { data: claimed, error } = await supabaseAdmin.from("marina_store_orders")
    .update({ confirmed_email_at: new Date().toISOString() })
    .eq("id", orderId).eq("company_id", companyId).is("confirmed_email_at", null).neq("status", "cancelled")
    .select("*");
  const o: any = !error && claimed?.[0];
  if (!o?.customer_email) return;
  const [{ data: company }, { data: st }] = await Promise.all([
    supabaseAdmin.from("companies").select("company_name, domain, contact_phone").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_store_settings").select("store_name").eq("company_id", companyId).maybeSingle(),
  ]);
  if (!company?.domain || isDemoDomain(company.domain)) return;
  const storeName = ((st as any)?.store_name || "").trim() || "Ship Store";
  try {
    await resend.emails.send({
      from: fromFor(company.company_name, company.domain),
      to: o.customer_email,
      subject: `Order ${o.order_number} confirmed — pickup code ${o.pickup_code || ""}`.trim(),
      html: storeOrderEmailHtml(o, company as any, storeName),
    });
  } catch (err: any) {
    console.error("store order email failed:", err?.message);
  }
}

// After a card payment is recorded on an invoice: if it belongs to a store order, confirm it.
export async function confirmStoreOrderForInvoice(companyId: string, invoiceId: string) {
  const { data, error } = await supabaseAdmin.from("marina_store_orders").select("id").eq("company_id", companyId).eq("invoice_id", invoiceId).maybeSingle();
  if (!error && data?.id) await sendStoreOrderConfirmation(companyId, data.id);
}
