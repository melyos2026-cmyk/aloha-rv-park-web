import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { startInvoicePayment } from "@/lib/marina/checkout";
import { round2, todayET } from "@/lib/marina/data";

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
    const { data } = await supabaseAdmin.from("marina_store_orders")
      .select("order_number, created_at, lines, total, fulfillment, slip_name, wanted_at, payment, status")
      .eq("company_id", company.id).eq("member_id", s!.memberId).order("created_at", { ascending: false }).limit(10);
    orders = data || [];
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
    .map((l: any) => ({ id: String(l?.id || ""), qty: Math.max(0, Math.min(99, Math.round(Number(l?.qty) || 0))) }))
    .filter((l: any) => l.id && l.qty > 0);
  if (!wanted.length) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
  const { data: items } = await supabaseAdmin.from("marina_store_items").select("id, name, price, taxable, stock, active")
    .eq("company_id", company.id).in("id", wanted.map((w: any) => w.id));
  const lines: { item_id: string; name: string; qty: number; price: number; taxable: boolean }[] = [];
  for (const w of wanted) {
    const it: any = (items || []).find((i: any) => i.id === w.id);
    if (!it || !it.active) return NextResponse.json({ error: "An item in your cart is no longer for sale. Please refresh the page." }, { status: 409 });
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

  const { data: order, error: oErr } = await supabaseAdmin.from("marina_store_orders").insert({
    company_id: company.id, order_number: orderNumber, member_id: memberId, invoice_id: invoice.id,
    customer_name: name, customer_email: email, customer_phone: phone || null, lines, subtotal, tax, total,
    fulfillment, slip_name: fulfillment === "slip" ? slip : null, wanted_at: text(b.when, 60) || null, notes: text(b.notes, 500) || null,
    payment, status: "placed",
  }).select("id").single();
  if (oErr || !order) {
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Store order could not be saved" }).eq("id", invoice.id).eq("company_id", company.id);
    return NextResponse.json({ error: "Online orders are not ready yet. Please visit the store." }, { status: 500 });
  }

  // Stock goes down when the order is placed (the office can cancel it to put it back).
  for (const l of lines) {
    const it: any = (items || []).find((i: any) => i.id === l.item_id);
    if (it && it.stock !== null) await supabaseAdmin.from("marina_store_items").update({ stock: Math.max(0, Number(it.stock) - l.qty) }).eq("id", it.id).eq("company_id", company.id);
  }
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: company.id, resident_name: name, update_type: "store_order",
    message: `New ${st.name} order ${orderNumber}: $${total.toFixed(2)} (${payment === "account" ? "charged to account" : "card"}), ${fulfillment === "slip" ? `bring to slip ${slip}` : "pickup at the store"}${b.when ? `, ${text(b.when, 60)}` : ""}.`,
  }).then(() => null, () => null);

  if (payment === "account") return NextResponse.json({ ok: true, order: orderNumber, total, charged: true });

  const origin = `https://${company.domain}`;
  const pay = await startInvoicePayment({
    company, invoiceId: invoice.id, memberId,
    successUrl: `${origin}/marina/store?order=${orderNumber}&paid=1`,
    cancelUrl: `${origin}/marina/store?order=${orderNumber}&paid=0`,
  });
  if (!pay.ok) {
    await supabaseAdmin.from("marina_store_orders").update({ status: "cancelled", status_by_name: "Payment could not start" }).eq("id", order.id);
    await supabaseAdmin.from("marina_invoices").update({ status: "void", voided_at: new Date().toISOString(), void_reason: "Payment could not be started" }).eq("id", invoice.id).eq("company_id", company.id);
    for (const l of lines) {
      const it: any = (items || []).find((i: any) => i.id === l.item_id);
      if (it && it.stock !== null) await supabaseAdmin.from("marina_store_items").update({ stock: Number(it.stock) }).eq("id", it.id).eq("company_id", company.id);
    }
    return NextResponse.json({ error: pay.error }, { status: pay.status });
  }
  return NextResponse.json("url" in pay ? { url: pay.url, order: orderNumber, total } : { ok: true, demo: true, order: orderNumber, total });
}
