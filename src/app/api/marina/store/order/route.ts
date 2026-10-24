import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { startInvoicePayment } from "@/lib/marina/checkout";
import { round2, todayET } from "@/lib/marina/data";
import { kitPrice, kitKeys, kitLineKey } from "@/lib/marina/store-kit";
import { newOrderSecrets, sendStoreOrderConfirmation } from "@/lib/marina/storeOrders";

// Oct 23 (per Mely): online orders from the marina's store page.
// GET → what the checkout needs (signed in?, tax, options).
// POST → places the order: prices, tax and stock are taken from the database (never from the
// browser); creates a normal marina invoice (category "store"); card = pay now (demo marinas
// record a demo payment), account = signed-in boaters charge it to their account.

async function settingsFor(companyId: string) {
  const { data, error } = await supabaseAdmin.from("marina_store_settings").select("*").eq("company_id", companyId).maybeSingle();
  const s: any = error ? {} : data || {};
  return { taxRate: Number(s.tax_rate || 0), online: s.online_orders !== false, slipDelivery: s.slip_delivery !== false, name: (s.store_name || "").trim() || "Ship Store" };
}

export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = getMarinaSession(req);
  const signedIn = !!s && s.companyId === company.id;
  let member: any = null;
  if (signedIn) {
    const { data } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", s!.memberId).eq("company_id", company.id).maybeSingle();
    member = data;
  }
  const { error: ready } = await supabaseAdmin.from("marina_store_orders").select("id", { head: true, count: "exact" }).eq("company_id", company.id);
  const st = await settingsFor(company.id);
  // Oct 23: the signed-in boater's own recent orders (shown in Boater login).
  let orders: any[] = [];
  if (signedIn && !ready) {
    const sel = (cols: string) => supabaseAdmin.from("marina_store_orders").select(cols)
      .eq("company_id", company.id).eq("member_id", s!.memberId).order("created_at", { ascending: false }).limit(10);
    let res: any = await sel("order_number, created_at, lines, total, fulfillment, slip_name, wanted_at, payment, status, access_token");
    if (res.error) res = await sel("order_number, created_at, lines, total, fulfillment, slip_name, wanted_at, payment, status");
    orders = res.data || [];
  }
  return NextResponse.json({ signedIn, member, taxRate: st.taxRate, online: st.online && !ready, slipDelivery: st.slipDelivery, storeName: st.name, orders });
}

const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const st = await settingsFor(company.id);
  if (!st.online) return NextResponse.json({ error: "Online orders are not available right now. Please visit the store." }, { status: 400 });

  const s = getMarinaSession(req);
  const memberId = s && s.companyId === company.id ? s.memberId : null;
  const payment = b.payment === "account" ? "account" : "card";
  if (payment === "account" && !memberId) return NextResponse.json({ error: "Sign in to your boater account to charge it to your account." }, { status: 401 });

  // Lines: [{id, qty}] → priced from the database.
  const wanted = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60)
    .map((l: any) => ({ id: String(l?.id || ""), variant: l?.variant ? String(l.variant).slice(0, 800) : "", qty: Math.max(0, Math.min(99, Math.round(Number(l?.qty) || 0))) }))
    .filter((l: any) => l.id && l.qty > 0);
  if (!wanted.length) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  const ids = wanted.map((w: any) => w.id);
  let itemsRes: any = await supabaseAdmin.from("marina_store_items").select("id, name, price, taxable, stock, active, variants, build_kit").eq("company_id", company.id).in("id", ids);
  if (itemsRes.error) itemsRes = await supabaseAdmin.from("marina_store_items").select("id, name, price, taxable, stock, active, variants").eq("company_id", company.id).in("id", ids);
  if (itemsRes.error) itemsRes = await supabaseAdmin.from("marina_store_items").select("id, name, price, taxable, stock, active").eq("company_id", company.id).in("id", wanted.map((w: any) => w.id));
  const items: any[] = itemsRes.data || [];
  const lines: { item_id: string; variant?: string; kit?: boolean; name: string; qty: number; price: number; taxable: boolean }[] = [];
  for (const w of wanted) {
    const it: any = items.find((i: any) => i.id === w.id);
    if (!it || !it.active) return NextResponse.json({ error: "An item in your cart is no longer for sale. Please refresh the page." }, { status: 409 });
    const variants: any[] = Array.isArray(it.variants) ? it.variants : [];
    if (variants.length && it.build_kit) {
      // Oct 24 (per Mely): build-your-own kit — the customer keeps the parts they want. Every part
      // kept = the full-kit price; otherwise the sum of the kept parts (prices from the database).
      const keep = [...new Set(kitKeys(w.variant))];
      const parts = keep.map((k) => variants.find((x: any) => String(x?.key || x?.name) === k));
      if (!keep.length || parts.some((x) => !x)) return NextResponse.json({ error: `Please choose what goes in your "${it.name}".` }, { status: 400 });
      const short = parts.find((x: any) => x.stock !== null && x.stock !== undefined && Number(x.stock) < w.qty);
      if (short) return NextResponse.json({ error: `Only ${Math.max(0, Number(short.stock))} left of "${short.name}" for the ${it.name}. Remove it or lower the quantity.` }, { status: 409 });
      const all = variants.map((x: any) => ({ key: String(x?.key || x?.name), price: Number(x?.price) }));
      const price = round2(kitPrice(Number(it.price), all, keep));
      const full = keep.length === all.length;
      lines.push({ item_id: it.id, variant: kitLineKey(keep), kit: true, name: `${it.name} — ${full ? "complete kit" : parts.map((x: any) => x.name).join(", ")}`.slice(0, 300), qty: w.qty, price, taxable: it.taxable !== false });
      continue;
    }
    if (variants.length) {
      // Oct 24: items with choices — price and stock come from the chosen variant.
      const v = variants.find((x: any) => String(x?.key || x?.name) === w.variant);
      if (!v) return NextResponse.json({ error: `Please choose an option for "${it.name}".` }, { status: 400 });
      if (v.stock !== null && v.stock !== undefined && Number(v.stock) < w.qty) return NextResponse.json({ error: `Only ${Math.max(0, Number(v.stock))} left of "${it.name} — ${v.name}".` }, { status: 409 });
      lines.push({ item_id: it.id, variant: String(v.key || v.name), name: `${it.name} — ${v.name}`, qty: w.qty, price: round2(Number(v.price)), taxable: it.taxable !== false });
      continue;
    }
    if (it.stock !== null && Number(it.stock) < w.qty) return NextResponse.json({ error: `Only ${Math.max(0, Number(it.stock))} left of "${it.name}".` }, { status: 409 });
    lines.push({ item_id: it.id, name: it.name, qty: w.qty, price: round2(Number(it.price)), taxable: it.taxable !== false });
  }
  const subtotal = round2(lines.reduce((a, l) => a + l.qty * l.price, 0));
  const tax = round2(lines.filter((l) => l.taxable).reduce((a, l) => a + l.qty * l.price, 0) * st.taxRate / 100);
  const total = round2(subtotal + tax);
  if (total <= 0) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  // Customer
  let name = text(b.name, 120), email = text(b.email, 160).toLowerCase(), phone = text(b.phone, 40);
  if (memberId) {
    const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, email, phone").eq("id", memberId).eq("company_id", company.id).maybeSingle();
    name = name || m?.full_name || ""; email = email || (m?.email || "").toLowerCase(); phone = phone || m?.phone || "";
  }
  if (!name) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email for your receipt." }, { status: 400 });
  const fulfillment = b.fulfillment === "slip" && st.slipDelivery ? "slip" : "pickup";
  const slip = text(b.slip, 20);
  if (fulfillment === "slip" && !slip) return NextResponse.json({ error: "Which slip should we bring it to?" }, { status: 400 });

  // Flood guard
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin.from("marina_store_orders").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", hourAgo);
  if ((count || 0) >= 80) return NextResponse.json({ error: "Too many orders right now. Please visit the store." }, { status: 429 });

  const today = todayET();
  const orderNumber = `SO-${today.replace(/-/g, "").slice(2)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const desc = `${st.name} order ${orderNumber}: ${lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}${tax ? ` + tax $${tax.toFixed(2)}` : ""}`.slice(0, 300);
  let invoice: { id: string } | null = null;
  for (let i = 0; i < 5 && !invoice; i++) {
    const number = `WEB-${today.replace(/-/g, "")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from("marina_invoices").insert({
      company_id: company.id, invoice_number: number, category: "store", member_id: memberId,
      customer_name: name, customer_email: email, description: desc, amount: total,
      issue_date: today, due_date: payment === "account" ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : today,
    }).select("id").single();
    if (data) invoice = data;
    else if (error?.code !== "23505") return NextResponse.json({ error: "Could not place your order. Please try again." }, { status: 500 });
  }
  if (!invoice) return NextResponse.json({ error: "Could not place your order. Please try again." }, { status: 500 });

  const row = {
    company_id: company.id, order_number: orderNumber, member_id: memberId, invoice_id: invoice.id,
    customer_name: name, customer_email: email, customer_phone: phone || null, lines, subtotal, tax, total,
    fulfillment, slip_name: fulfillment === "slip" ? slip : null, wanted_at: text(b.when, 60) || null, notes: text(b.notes, 500) || null,
    payment, status: "placed",
  };
  // Oct 24 (per Mely): private order link + 4-digit pickup code (after scripts/marina_65_store_order_pickup.sql).
  const secrets = newOrderSecrets();
  let ins: any = await supabaseAdmin.from("marina_store_orders").insert({ ...row, ...secrets }).select("id").single();
  let token: string | null = secrets.access_token;
  if (ins.error && /access_token|pickup_code/.test(ins.error.message || "")) { token = null; ins = await supabaseAdmin.from("marina_store_orders").insert(row).select("id").single(); }
  const { data: order, error: oErr } = ins;
  if (oErr || !order) {
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Store order could not be saved" }).eq("id", invoice.id).eq("company_id", company.id);
    return NextResponse.json({ error: "Online orders are not ready yet. Please visit the store." }, { status: 500 });
  }

  // Stock goes down when the order is placed (the office can cancel it to put it back).
  await adjustStock(company.id, items, lines, -1);
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "store_order",
    message: `New ${st.name} order ${orderNumber}: $${total.toFixed(2)} (${payment === "account" ? "charged to account" : "card"}), ${fulfillment === "slip" ? `bring to slip ${slip}` : "pickup at the store"}${b.when ? `, ${text(b.when, 60)}` : ""}.`,
  }).then(() => null, () => null);

  if (payment === "account") {
    await sendStoreOrderConfirmation(company.id, order.id);
    return NextResponse.json({ ok: true, order: orderNumber, token, total, charged: true });
  }

  const origin = `https://${company.domain}`;
  const pay = await startInvoicePayment({
    company, invoiceId: invoice.id, memberId,
    successUrl: token ? `${origin}/marina/store/order/${orderNumber}?t=${token}&paid=1` : `${origin}/marina/store?order=${orderNumber}&paid=1`,
    cancelUrl: `${origin}/marina/store?order=${orderNumber}&paid=0`,
  });
  if (!pay.ok) {
    await supabaseAdmin.from("marina_store_orders").update({ status: "cancelled", status_by_name: "Payment could not start" }).eq("id", order.id);
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Payment could not be started" }).eq("id", invoice.id).eq("company_id", company.id);
    await adjustStock(company.id, items, lines, +1);
    return NextResponse.json({ error: pay.error }, { status: pay.status });
  }
  return NextResponse.json("url" in pay ? { url: pay.url, order: orderNumber, token, total } : { ok: true, demo: true, order: orderNumber, token, total });
}

// Oct 24: stock per item, or per chosen variant. dir = -1 takes stock, +1 gives it back.
async function adjustStock(companyId: string, items: any[], lines: { item_id: string; variant?: string; qty: number }[], dir: 1 | -1) {
  const byItem = new Map<string, { item: any; plain: number; byVariant: Map<string, number> }>();
  for (const l of lines) {
    const it = items.find((i: any) => i.id === l.item_id); if (!it) continue;
    const e = byItem.get(it.id) || { item: it, plain: 0, byVariant: new Map<string, number>() };
    // Oct 24: a kit line takes stock from each part it includes.
    if (l.variant) for (const k of it.build_kit ? kitKeys(l.variant) : [l.variant]) e.byVariant.set(k, (e.byVariant.get(k) || 0) + l.qty);
    else e.plain += l.qty;
    byItem.set(it.id, e);
  }
  for (const { item, plain, byVariant } of byItem.values()) {
    const upd: any = {};
    if (plain && item.stock !== null && item.stock !== undefined) upd.stock = Math.max(0, Number(item.stock) + dir * plain);
    if (byVariant.size && Array.isArray(item.variants)) {
      upd.variants = item.variants.map((v: any) => {
        const q = byVariant.get(String(v?.key || v?.name)); if (!q || v.stock === null || v.stock === undefined) return v;
        return { ...v, stock: Math.max(0, Number(v.stock) + dir * q) };
      });
    }
    if (Object.keys(upd).length) await supabaseAdmin.from("marina_store_items").update(upd).eq("id", item.id).eq("company_id", companyId);
  }
}
