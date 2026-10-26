import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, calculateAchFee, resolveConnectSplit } from "@/lib/platformFee";
import type { MarinaCompany } from "./company";
import { isDemoCompany } from "./host";
import { round2, todayET } from "./data";
import { recordMarinaOnlinePayment, settleMarinaAchPayment, failMarinaAchPayment } from "./payments";
import { mailBoater, mailOffice } from "./slipAuto";

// Oct 26 (per Mely — Group 2): autopay for boaters. They save a card or a bank account (Stripe
// Checkout in "setup" mode) and accept a written authorization. Every morning, everything that is
// due on their account (slip fees, contract installments, electricity, store charges, booking
// balances) is charged in ONE payment with the same fee and Connect split as paying online.
// Cards succeed or fail at once; bank payments clear in a few days (pending → settled by the
// reconcile step, which asks Stripe, so it works even without extra webhook events).

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const MAX_INVOICES = 10;

export const authText = (marina: string, method: string) =>
  `I authorize ${marina} to charge my ${method === "ach" ? "bank account" : "card"} on file automatically for the invoices on my boater account on or after their due date (slip fees, contract payments, utilities, store charges and booking balances), plus the processing fee shown in my account, until I turn autopay off in my account. I can turn it off at any time.`;

export async function autopayStatus(companyId: string, memberId: string) {
  const { data: m, error } = await supabaseAdmin.from("marina_members").select("autopay_enabled, autopay_method, autopay_label, autopay_authorized_at, autopay_failed_at, autopay_fail_note").eq("id", memberId).eq("company_id", companyId).maybeSingle();
  if (error) return { ready: false as const };
  const { data: attempts } = await supabaseAdmin.from("marina_autopay_attempts").select("run_date, amount, fee, status, error").eq("company_id", companyId).eq("member_id", memberId).order("created_at", { ascending: false }).limit(5);
  return { ready: true as const, enabled: !!m?.autopay_enabled, method: m?.autopay_method || null, label: m?.autopay_label || null, since: m?.autopay_authorized_at || null, failedAt: m?.autopay_failed_at || null, failNote: m?.autopay_fail_note || null, history: attempts || [] };
}

// Start saving a card / bank account. Returns the Stripe page to open (or turns it on at once on a demo marina).
export async function startAutopay(company: MarinaCompany, memberId: string, method: "card" | "ach", ip: string | null): Promise<{ url: string } | { demo: true } | { error: string }> {
  const { data: m } = await supabaseAdmin.from("marina_members").select("id, full_name, email, stripe_customer_id").eq("id", memberId).eq("company_id", company.id).maybeSingle();
  if (!m) return { error: "Account not found." };
  if (isDemoCompany(company)) {
    const { error } = await supabaseAdmin.from("marina_members").update({
      autopay_enabled: true, autopay_method: "demo", autopay_label: method === "ach" ? "Demo bank •••• 6789" : "Demo card •••• 4242", autopay_pm_id: null,
      autopay_authorized_at: new Date().toISOString(), autopay_auth_text: authText(company.company_name, method), autopay_auth_ip: ip, autopay_failed_at: null, autopay_fail_note: null,
    }).eq("id", memberId).eq("company_id", company.id);
    return error ? { error: /autopay/.test(error.message) ? "Autopay is not set up yet. Please ask the marina." : error.message } : { demo: true };
  }
  if (!stripe) return { error: "Online payments aren't set up for this marina yet." };
  if (method === "ach") {
    const { data: fs } = await supabaseAdmin.from("company_fee_settings").select("ach_enabled").eq("company_id", company.id).maybeSingle();
    if (fs?.ach_enabled === false) return { error: "This marina doesn't take bank payments. Please use a card." };
  }
  let customer = m.stripe_customer_id as string | null;
  if (!customer) {
    const c = await stripe.customers.create({ name: m.full_name, email: m.email || undefined, metadata: { type: "marina_member", company_id: company.id, member_id: memberId } });
    customer = c.id;
    await supabaseAdmin.from("marina_members").update({ stripe_customer_id: customer }).eq("id", memberId).eq("company_id", company.id);
  }
  const origin = `https://${company.domain}`;
  const s = await stripe.checkout.sessions.create({
    mode: "setup", customer, currency: "usd",
    payment_method_types: method === "ach" ? ["us_bank_account"] : ["card"],
    ...(method === "ach" ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } } } : {}),
    metadata: { type: "marina_autopay_setup", company_id: company.id, member_id: memberId, method },
    success_url: `${origin}/marina/account?autopay=done&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/marina/account?autopay=cancelled`,
  });
  return s.url ? { url: s.url } : { error: "Could not open the secure page. Please try again." };
}

// Back from Stripe: save the card / bank account and turn autopay on.
export async function confirmAutopay(company: MarinaCompany, memberId: string, sessionId: string, ip: string | null): Promise<{ ok: true; label: string } | { error: string }> {
  if (!stripe || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { error: "Session not found." };
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent.payment_method"] });
  if (s.metadata?.type !== "marina_autopay_setup" || s.metadata.company_id !== company.id || s.metadata.member_id !== memberId) return { error: "Session not found." };
  const si = s.setup_intent as Stripe.SetupIntent | null;
  const pm = si?.payment_method as Stripe.PaymentMethod | null;
  if (!si || !pm || (si.status !== "succeeded" && si.status !== "processing")) return { error: "The card or bank account was not saved. Please try again." };
  const method = pm.type === "us_bank_account" ? "ach" : "card";
  const label = method === "ach" ? `${pm.us_bank_account?.bank_name || "Bank"} •••• ${pm.us_bank_account?.last4 || ""}` : `${String(pm.card?.brand || "Card").replace(/^\w/, (c) => c.toUpperCase())} •••• ${pm.card?.last4 || ""}`;
  const { error } = await supabaseAdmin.from("marina_members").update({
    autopay_enabled: true, autopay_pm_id: pm.id, autopay_method: method, autopay_label: label,
    autopay_authorized_at: new Date().toISOString(), autopay_auth_text: authText(company.company_name, method), autopay_auth_ip: ip, autopay_failed_at: null, autopay_fail_note: null,
  }).eq("id", memberId).eq("company_id", company.id);
  if (error) return { error: error.message };
  const { data: m } = await supabaseAdmin.from("marina_members").select("full_name").eq("id", memberId).maybeSingle();
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: m?.full_name || "Boater", update_type: "autopay_enabled", message: `${m?.full_name || "A boater"} turned on autopay (${label}) and accepted the automatic payment authorization.` }).then(() => null, () => null);
  return { ok: true, label };
}

export async function stopAutopay(company: MarinaCompany, memberId: string) {
  const { data: m } = await supabaseAdmin.from("marina_members").select("full_name, autopay_pm_id").eq("id", memberId).eq("company_id", company.id).maybeSingle();
  await supabaseAdmin.from("marina_members").update({ autopay_enabled: false, autopay_pm_id: null, autopay_label: null, autopay_method: null }).eq("id", memberId).eq("company_id", company.id);
  if (stripe && m?.autopay_pm_id) await stripe.paymentMethods.detach(m.autopay_pm_id).catch(() => null);
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: m?.full_name || "Boater", update_type: "autopay_disabled", message: `${m?.full_name || "A boater"} turned off autopay.` }).then(() => null, () => null);
}

// What autopay would charge today for one boater: their open invoices due today or earlier.
export async function dueForAutopay(companyId: string, memberId: string) {
  const today = todayET();
  const { data: invs } = await supabaseAdmin.from("marina_invoices").select("id, invoice_number, description, amount, due_date").eq("company_id", companyId).eq("member_id", memberId).eq("status", "open").lte("due_date", today).order("due_date").limit(50);
  const ids = (invs || []).map((i: any) => i.id);
  if (!ids.length) return [];
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at").eq("company_id", companyId).in("invoice_id", ids);
  const paid: Record<string, number> = {};
  for (const p of pays || []) if (!p.returned_at) paid[p.invoice_id] = (paid[p.invoice_id] || 0) + Number(p.amount);
  return (invs || []).map((i: any) => ({ ...i, balance: round2(Number(i.amount) - (paid[i.id] || 0)) })).filter((i) => i.balance > 0).slice(0, MAX_INVOICES);
}

// One boater, one day: charge everything due in one payment.
export async function chargeMember(company: MarinaCompany, m: any): Promise<{ status: "none" | "succeeded" | "processing" | "failed" | "skipped"; amount?: number; error?: string }> {
  const rows = await dueForAutopay(company.id, m.id);
  if (!rows.length) return { status: "none" };
  const today = todayET();
  const total = round2(rows.reduce((a, r) => a + r.balance, 0));
  const ach = m.autopay_method === "ach";
  const demo = isDemoCompany(company) || m.autopay_method === "demo";
  const { data: fs } = await supabaseAdmin.from("company_fee_settings").select("pass_processing_fee_to_resident").eq("company_id", company.id).maybeSingle();
  const passFee = fs?.pass_processing_fee_to_resident !== false;
  const fee = demo ? 0 : round2(ach ? calculateAchFee(total) : calculateProcessingFee(total));
  const charge = round2(total + (passFee ? fee : 0));
  // claim the day first (one attempt per boater per day)
  const { data: att, error: attErr } = await supabaseAdmin.from("marina_autopay_attempts").insert({
    company_id: company.id, member_id: m.id, run_date: today, invoice_ids: rows.map((r) => r.id), amount: total, fee: passFee ? fee : 0, method: demo ? "demo" : ach ? "ach" : "card", status: "processing",
  }).select("id").single();
  if (attErr || !att) return { status: "skipped" };
  const finish = (patch: Record<string, unknown>) => supabaseAdmin.from("marina_autopay_attempts").update(patch).eq("id", att.id);

  if (demo) {
    const ref = `autopay:demo-${crypto.randomUUID()}`;
    for (let i = 0; i < rows.length; i++) await recordMarinaOnlinePayment({ companyId: company.id, invoiceId: rows[i].id, amount: rows[i].balance, reference: `${ref}:${i + 1}`, demo: true, method: "card" });
    await finish({ status: "succeeded" });
    return { status: "succeeded", amount: total };
  }
  if (!stripe || !m.stripe_customer_id || !m.autopay_pm_id) { await finish({ status: "failed", error: "No saved payment method" }); return { status: "failed", error: "No saved payment method" }; }
  const split = await resolveConnectSplit(company.id, charge, total + (passFee ? 0 : -fee));
  if (!split) { await finish({ status: "failed", error: "Marina has no connected Stripe account" }); return { status: "failed", error: "The marina's online payments are not set up." }; }
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(charge * 100), currency: "usd", customer: m.stripe_customer_id, payment_method: m.autopay_pm_id, off_session: true, confirm: true,
      payment_method_types: [ach ? "us_bank_account" : "card"],
      description: `Autopay — ${company.company_name}: ${rows.map((r) => r.invoice_number).join(", ")}`.slice(0, 900),
      application_fee_amount: split.applicationFeeAmountCents, transfer_data: { destination: split.connectedAccountId },
      ...(split.statementDescriptorSuffix ? { statement_descriptor_suffix: split.statementDescriptorSuffix } : {}),
      metadata: { type: "marina_autopay", company_id: company.id, member_id: m.id, allocs: rows.map((r) => `${r.id}:${r.balance}`).join(";").slice(0, 490) },
    }, { idempotencyKey: `marina-autopay-${m.id}-${today}-${Math.round(charge * 100)}` });
    const ok = pi.status === "succeeded", pending = pi.status === "processing";
    if (ok || pending) {
      for (let i = 0; i < rows.length; i++) await recordMarinaOnlinePayment({ companyId: company.id, invoiceId: rows[i].id, amount: rows[i].balance, reference: `autopay:${pi.id}:${i + 1}`, method: ach ? "ach" : "card", pending });
      await finish({ status: ok ? "succeeded" : "processing", payment_intent_id: pi.id });
      await supabaseAdmin.from("marina_members").update({ autopay_failed_at: null, autopay_fail_note: null }).eq("id", m.id).eq("company_id", company.id);
      await mailBoater(company, m.email, `Autopay: ${money(charge)} ${ok ? "paid" : "is on its way from your bank"}`, ok ? "Payment received, thank you!" : "Bank payment started", [
        `We charged ${esc(m.autopay_label || "your saved payment method")} <b>${money(charge)}</b> for ${rows.map((r) => esc(r.invoice_number)).join(", ")}${passFee && fee ? ` (includes a ${money(fee)} processing fee)` : ""}.`,
        pending ? "Bank payments take 3 to 5 business days to clear." : "Your receipt is in your boater account.",
      ], { label: "Open my account", url: `https://${company.domain}/marina/account` });
      return { status: ok ? "succeeded" : "processing", amount: total };
    }
    throw new Error(`Payment ${pi.status}`);
  } catch (e: any) {
    const msg = String(e?.raw?.message || e?.message || "The payment was declined.").slice(0, 300);
    await finish({ status: "failed", error: msg });
    await supabaseAdmin.from("marina_members").update({ autopay_failed_at: new Date().toISOString(), autopay_fail_note: msg }).eq("id", m.id).eq("company_id", company.id);
    await mailBoater(company, m.email, "Autopay didn't go through", "We couldn't charge your autopay", [
      `We tried to charge ${esc(m.autopay_label || "your saved payment method")} ${money(charge)} for ${rows.map((r) => esc(r.invoice_number)).join(", ")}: ${esc(msg)}`,
      "Please pay in your account or update your card. We'll try again tomorrow.",
    ], { label: "Pay or update my card", url: `https://${company.domain}/marina/account` });
    return { status: "failed", amount: total, error: msg };
  }
}

// Bank autopay payments still pending: ask Stripe and settle or fail them.
export async function reconcileAutopay() {
  if (!stripe) return 0;
  const { data } = await supabaseAdmin.from("marina_autopay_attempts").select("id, company_id, payment_intent_id").eq("status", "processing").not("payment_intent_id", "is", null).limit(200);
  let n = 0;
  for (const a of data || []) {
    const pi = await stripe.paymentIntents.retrieve(a.payment_intent_id).catch(() => null);
    if (!pi) continue;
    if (pi.status === "succeeded") { await settleMarinaAchPayment(a.company_id, `autopay:${pi.id}`); await supabaseAdmin.from("marina_autopay_attempts").update({ status: "succeeded" }).eq("id", a.id); n++; }
    else if (pi.status === "requires_payment_method" || pi.status === "canceled") { await failMarinaAchPayment(a.company_id, `autopay:${pi.id}`, pi.last_payment_error?.message || "the bank declined the transfer"); await supabaseAdmin.from("marina_autopay_attempts").update({ status: "failed", error: pi.last_payment_error?.message || "Bank declined" }).eq("id", a.id); n++; }
  }
  return n;
}

// The daily run for one marina; the office gets one summary email.
export async function runMarinaAutopay(company: MarinaCompany) {
  const { data: members, error } = await supabaseAdmin.from("marina_members").select("id, full_name, email, stripe_customer_id, autopay_pm_id, autopay_method, autopay_label").eq("company_id", company.id).eq("autopay_enabled", true);
  if (error) return { error: error.message };
  const done: { name: string; amount: number }[] = [], failed: { name: string; amount: number; error: string }[] = [];
  for (const m of members || []) {
    const r = await chargeMember(company, m).catch((e: any) => ({ status: "failed" as const, amount: 0, error: e?.message || "error" }));
    if (r.status === "succeeded" || r.status === "processing") done.push({ name: m.full_name, amount: r.amount || 0 });
    if (r.status === "failed") failed.push({ name: m.full_name, amount: r.amount || 0, error: r.error || "" });
  }
  if (done.length || failed.length) {
    await mailOffice(company, `Autopay today: ${done.length} paid${failed.length ? `, ${failed.length} failed` : ""}`, [
      done.length ? `<b>Charged:</b> ${done.map((d) => `${esc(d.name)} ${money(d.amount)}`).join(", ")}. Total ${money(done.reduce((a, d) => a + d.amount, 0))}.` : "",
      failed.length ? `<b>Failed:</b> ${failed.map((f) => `${esc(f.name)} ${money(f.amount)} (${esc(f.error)})`).join("; ")}. They were emailed; we try again tomorrow.` : "",
    ].filter(Boolean));
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: "Autopay", update_type: "autopay_run", message: `Autopay today: ${done.length} paid${failed.length ? `, ${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : ""}.` }).then(() => null, () => null);
  }
  return { paid: done.length, failed: failed.length };
}

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, "");
