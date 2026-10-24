import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isDemoCompany } from "./host";
import { kitKeys } from "./store-kit";

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
  if (!o) return;
  // Oct 24 (security run): a card order is real only once paid — take its stock and tell the office now.
  if (o.payment === "card") {
    await adjustOrderStock(companyId, o.lines || [], -1);
    await notifyOfficeOfOrder(companyId, o.id);
  }
  // Oct 24 (per Mely): signed-in boaters also get it in Boater login → Messages (works on the demo too).
  if (o.member_id) {
    const items = (o.lines || []).map((l: any) => `${Number(l.qty)} × ${l.name}`).join(", ");
    await supabaseAdmin.from("marina_messages").insert({
      company_id: companyId, member_id: o.member_id, direction: "office", sent_by_name: "Ship Store",
      subject: `Order ${o.order_number} received`.slice(0, 200),
      body: `We have your order (${o.fulfillment === "slip" ? `delivery to slip ${o.slip_name}` : "pickup at the store"}${o.pickup_code ? `, pickup code ${o.pickup_code}` : ""}): ${items}. Total $${Number(o.total).toFixed(2)}${o.payment === "account" ? ", charged to your account" : ", paid"}. We'll message you when it's ${o.fulfillment === "slip" ? "on the way" : "ready"}.`.slice(0, 2000),
    }).then(() => null, () => null);
  }
  if (!o.customer_email) return;
  const [{ data: company }, { data: st }] = await Promise.all([
    supabaseAdmin.from("companies").select("company_name, domain, contact_phone, is_demo").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_store_settings").select("store_name").eq("company_id", companyId).maybeSingle(),
  ]);
  if (!company?.domain || isDemoCompany(company as any)) return;
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

// Oct 24 (security run): stock per item, or per chosen variant / kit part. dir = -1 takes stock,
// +1 gives it back. Each item is updated only if it hasn't changed since we read it (retried a few
// times), so two orders at the same moment can't both write over each other's count.
export async function adjustOrderStock(companyId: string, lines: { item_id?: string; variant?: string; kit?: boolean; qty: number }[], dir: 1 | -1) {
  const need = new Map<string, { plain: number; byVariant: Map<string, number> }>();
  for (const l of lines || []) {
    if (!l?.item_id) continue;
    const e = need.get(l.item_id) || { plain: 0, byVariant: new Map<string, number>() };
    const q = Math.max(0, Number(l.qty) || 0);
    if (l.variant) for (const k of l.kit ? kitKeys(l.variant) : [l.variant]) e.byVariant.set(k, (e.byVariant.get(k) || 0) + q);
    else e.plain += q;
    need.set(l.item_id, e);
  }
  for (const [itemId, { plain, byVariant }] of need) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let r: any = await supabaseAdmin.from("marina_store_items").select("id, stock, variants, build_kit").eq("id", itemId).eq("company_id", companyId).maybeSingle();
      if (r.error) r = await supabaseAdmin.from("marina_store_items").select("id, stock, variants").eq("id", itemId).eq("company_id", companyId).maybeSingle();
      const item: any = r.data; if (!item) break;
      const upd: any = {};
      if (plain && item.stock !== null && item.stock !== undefined) upd.stock = Math.max(0, Number(item.stock) + dir * plain);
      if (byVariant.size && Array.isArray(item.variants)) {
        upd.variants = item.variants.map((v: any) => {
          const q = byVariant.get(String(v?.key || v?.name)); if (!q || v.stock === null || v.stock === undefined) return v;
          return { ...v, stock: Math.max(0, Number(v.stock) + dir * q) };
        });
      }
      if (!Object.keys(upd).length) break;
      let q = supabaseAdmin.from("marina_store_items").update(upd).eq("id", itemId).eq("company_id", companyId);
      q = item.stock === null || item.stock === undefined ? q.is("stock", null) : q.eq("stock", item.stock);
      const { data: done } = await q.select("id");
      if (done?.length) break;
    }
  }
}

// Office alert ("New order …") — for card orders, sent only after the payment is recorded.
export async function notifyOfficeOfOrder(companyId: string, orderId: string) {
  const [{ data: o }, { data: st }] = await Promise.all([
    supabaseAdmin.from("marina_store_orders").select("order_number, customer_name, total, payment, fulfillment, slip_name, wanted_at").eq("id", orderId).eq("company_id", companyId).maybeSingle(),
    supabaseAdmin.from("marina_store_settings").select("store_name").eq("company_id", companyId).maybeSingle(),
  ]);
  if (!o) return;
  const storeName = ((st as any)?.store_name || "").trim() || "Ship Store";
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: companyId, resident_name: o.customer_name, update_type: "store_order",
    message: `New ${storeName} order ${o.order_number}: $${Number(o.total).toFixed(2)} (${o.payment === "account" ? "charged to account" : "paid by card"}), ${o.fulfillment === "slip" ? `bring to slip ${o.slip_name}` : "pickup at the store"}${o.wanted_at ? `, ${o.wanted_at}` : ""}.`,
  }).then(() => null, () => null);
}
