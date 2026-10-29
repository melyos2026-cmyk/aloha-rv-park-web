import crypto from "crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { calculateProcessingFee, calculateAchFee, resolveConnectSplit, loadReturnedFeeSettings, returnedFeePhrase, returnedFeeRuleToDisclose, loadAutopayAuthorizationRule, saveAutopayAuthorizationRule } from "@/lib/platformFee";
import type { MarinaCompany } from "./company";
import { isDemoCompany } from "./host";
import { round2, todayET } from "./data";
import { recordMarinaOnlinePayment, settleMarinaAchPayment, failMarinaAchPayment } from "./payments";
import { marinaReturnedFeeMelyosPart } from "./returnedFee";
import { mailBoater, mailOffice } from "./slipAuto";

// Oct 26 (per Mely — Group 2): autopay for boaters. They save a card or a bank account (Stripe
// Checkout in "setup" mode) and accept a written authorization. Every morning, everything that is
// due on their account (slip fees, contract installments, electricity, store charges, booking
// balances) is charged in ONE payment with the same fee and Connect split as paying online.
// Cards succeed or fail at once; bank payments clear in a few days (pending → settled by the
// reconcile step, which asks Stripe, so it works even without extra webhook events).

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const MAX_INVOICES = 10;

// Oct 28 (per Mely): bank autopay also states the marina's returned-payment fee rule (returnFeePhrase,
// from returnedFeePhrase — e.g. "a returned-payment fee of $15 or 5% of the payment, whichever is greater, applies").
export const authText = (marina: string, method: string, returnFeePhrase?: string | null) =>
  `I authorize ${marina} to charge my ${method === "ach" ? "bank account" : "card"} on file automatically for the invoices on my boater account on or after their due date (slip fees, contract payments, utilities, store charges and booking balances), plus the processing fee shown in my account, until I turn autopay off in my account.${method === "ach" && returnFeePhrase ? ` If my bank returns a payment, ${returnFeePhrase}.` : ""} I can turn it off at any time.`;
export async function marinaReturnFeePhrase(companyId: string) {
  return returnedFeePhrase(await loadReturnedFeeSettings(companyId, "marina"));
}

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
      autopay_authorized_at: new Date().toISOString(), autopay_auth_text: authText(company.company_name, method, await marinaReturnFeePhrase(company.id)), autopay_auth_ip: ip, autopay_failed_at: null, autopay_fail_note: null,
    }).eq("id", memberId).eq("company_id", company.id);
    if (!error) await saveAutopayAuthorizationRule("marina_members", memberId, company.id, "marina"); // Oct 28: rule accepted
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
  if (Date.now() - s.created * 1000 > 24 * 3600000) return { error: "This link is old. Please turn autopay on again." };
  const si = s.setup_intent as Stripe.SetupIntent | null;
  const pm = si?.payment_method as Stripe.PaymentMethod | null;
  if (si?.status === "processing" || si?.status === "requires_action") return { error: "Your bank is still verifying the account (this can take 1–2 days). Turn autopay on again once it's verified." };
  if (!si || !pm || si.status !== "succeeded") return { error: "The card or bank account was not saved. Please try again." };
  const method = pm.type === "us_bank_account" ? "ach" : "card";
  const label = method === "ach" ? `${pm.us_bank_account?.bank_name || "Bank"} •••• ${pm.us_bank_account?.last4 || ""}` : `${String(pm.card?.brand || "Card").replace(/^\w/, (c) => c.toUpperCase())} •••• ${pm.card?.last4 || ""}`;
  const { error } = await supabaseAdmin.from("marina_members").update({
    autopay_enabled: true, autopay_pm_id: pm.id, autopay_method: method, autopay_label: label,
    autopay_authorized_at: new Date().toISOString(), autopay_auth_text: authText(company.company_name, method, await marinaReturnFeePhrase(company.id)), autopay_auth_ip: ip, autopay_failed_at: null, autopay_fail_note: null,
  }).eq("id", memberId).eq("company_id", company.id);
  if (error) return { error: error.message };
  await saveAutopayAuthorizationRule("marina_members", memberId, company.id, "marina"); // Oct 28: the returned-fee rule accepted
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
  const { data: invs0 } = await supabaseAdmin.from("marina_invoices").select("*").eq("company_id", companyId).eq("member_id", memberId).eq("status", "open").lte("due_date", today).order("due_date").limit(50);
  const invs = (invs0 || []).filter((i: any) => !i.on_hold); // Oct 27: never autopay a booking on a card hold
  const ids = (invs || []).map((i: any) => i.id);
  if (!ids.length) return [];
  const { data: pays } = await supabaseAdmin.from("marina_invoice_payments").select("invoice_id, amount, returned_at").eq("company_id", companyId).in("invoice_id", ids);
  const paid: Record<string, number> = {};
  const returned = new Set<string>();
  for (const p of pays || []) { if (p.returned_at) returned.add(p.invoice_id); else paid[p.invoice_id] = (paid[p.invoice_id] || 0) + Number(p.amount); }
  // An invoice that had money given back (refund, dispute, bounced payment) is never charged again
  // automatically; the office or the boater decides.
  return (invs || []).map((i: any) => ({ ...i, balance: round2(Number(i.amount) - (paid[i.id] || 0)) })).filter((i) => i.balance > 0 && !returned.has(i.id)).slice(0, MAX_INVOICES);
}

// One boater, one day: charge everything due in one payment.
export async function chargeMember(company: MarinaCompany, m: any): Promise<{ status: "none" | "succeeded" | "processing" | "failed" | "skipped"; amount?: number; error?: string }> {
  const rows = await dueForAutopay(company.id, m.id);
  if (!rows.length) return { status: "none" };
  const today = todayET();
  const total = round2(rows.reduce((a, r) => a + r.balance, 0));
  const ach = m.autopay_method === "ach";
  const demo = isDemoCompany(company);
  const { data: fs } = await supabaseAdmin.from("company_fee_settings").select("pass_processing_fee_to_resident, ach_enabled").eq("company_id", company.id).maybeSingle();
  const passFee = fs?.pass_processing_fee_to_resident !== false;
  const fee = demo ? 0 : round2(ach ? calculateAchFee(total) : calculateProcessingFee(total));
  const charge = round2(total + (passFee ? fee : 0));
  // claim the day first (one attempt per boater per day)
  const { data: att, error: attErr } = await supabaseAdmin.from("marina_autopay_attempts").insert({
    company_id: company.id, member_id: m.id, run_date: today, invoice_ids: rows.map((r) => r.id), amount: total, fee: passFee ? fee : 0, method: demo ? "demo" : ach ? "ach" : "card", status: "processing",
  }).select("id").single();
  if (attErr || !att) return { status: "skipped" };
  const finish = (patch: Record<string, unknown>) => supabaseAdmin.from("marina_autopay_attempts").update(patch).eq("id", att.id);
  const fail = async (msg: string, emailIt = true) => {
    await finish({ status: "failed", error: msg });
    await supabaseAdmin.from("marina_members").update({ autopay_failed_at: new Date().toISOString(), autopay_fail_note: msg }).eq("id", m.id).eq("company_id", company.id);
    if (emailIt) await mailBoater(company, m.email, "Autopay didn't go through", "We couldn't charge your autopay", [
      `We tried to charge ${esc(m.autopay_label || "your saved payment method")} ${money(charge)} for ${rows.map((r) => esc(r.invoice_number)).join(", ")}: ${esc(msg)}`,
      "Please pay in your account or update your card or bank. We'll try again tomorrow.",
    ], { label: "Pay or update", url: `https://${company.domain}/marina/account#autopay` });
    return { status: "failed" as const, amount: total, error: msg };
  };

  if (demo) {
    const ref = `autopay:demo-${att.id}`;
    for (let i = 0; i < rows.length; i++) await recordMarinaOnlinePayment({ companyId: company.id, invoiceId: rows[i].id, amount: rows[i].balance, reference: `${ref}:${i + 1}`, demo: true, method: "card" }).catch(() => null);
    await finish({ status: "succeeded" });
    return { status: "succeeded", amount: total };
  }
  if (m.autopay_method === "demo") return fail("This payment method was saved on a demo. Please turn autopay on again with a real card or bank account.");
  if (ach && fs?.ach_enabled === false) return fail("The marina no longer takes bank payments. Please turn autopay on again with a card.");
  if (!stripe || !m.stripe_customer_id || !m.autopay_pm_id) return fail("No saved payment method. Please turn autopay on again.");
  // Oct 28 (per Mely): MelyOS's share of a returned-payment fee invoice goes to MelyOS, not the marina.
  const returnedFeeMelyos = await marinaReturnedFeeMelyosPart(company.id, rows.map((r) => ({ id: r.id, balance: r.balance })));
  const split = await resolveConnectSplit(company.id, charge, Math.max(total + (passFee ? 0 : -fee) - returnedFeeMelyos, 0));
  if (!split) return fail("The marina's online payments are not set up.", false);

  // Only the charge itself is in this try: anything that fails AFTER money moved must never be
  // reported as a failed payment.
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.create({
      amount: Math.round(charge * 100), currency: "usd", customer: m.stripe_customer_id, payment_method: m.autopay_pm_id, off_session: true, confirm: true,
      payment_method_types: [ach ? "us_bank_account" : "card"],
      description: `Autopay — ${company.company_name}: ${rows.map((r) => r.invoice_number).join(", ")}`.slice(0, 900),
      application_fee_amount: split.applicationFeeAmountCents, transfer_data: { destination: split.connectedAccountId },
      ...(split.statementDescriptorSuffix ? { statement_descriptor_suffix: split.statementDescriptorSuffix } : {}),
      metadata: {
        type: "marina_autopay", company_id: company.id, member_id: m.id, attempt_id: att.id, allocs: rows.map((r) => `${r.id}:${r.balance}`).join(";").slice(0, 490),
        // Oct 28 (review): the returned-payment fee rule the boater accepted with autopay (bank only).
        ...(ach ? { returned_fee_rule: await (async () => { const a = await loadAutopayAuthorizationRule("marina_members", m.id, company.id); return returnedFeeRuleToDisclose("marina", company.id, { authorizedAt: a.authorizedAt, storedRule: a.rule }); })() } : {}),
      },
    }, { idempotencyKey: `marina-autopay-${att.id}` });
  } catch (e: any) {
    const id = e?.raw?.payment_intent?.id || null;
    if (id) await finish({ payment_intent_id: id });
    return fail(String(e?.raw?.message || e?.message || "The payment was declined.").slice(0, 300));
  }
  await finish({ payment_intent_id: pi.id });
  if (pi.status !== "succeeded" && pi.status !== "processing") return fail(`Payment ${pi.status.replace(/_/g, " ")}`);
  return afterCharge(company, m, att.id, pi, rows, charge, passFee ? fee : 0);
}

// Money moved (or is moving, for a bank): record it on the invoices, receipt to the boater.
async function afterCharge(company: MarinaCompany, m: any, attemptId: string, pi: Stripe.PaymentIntent, rows: { id: string; balance: number; invoice_number: string }[], charge: number, fee: number) {
  const ok = pi.status === "succeeded";
  const ach = pi.payment_method_types?.includes("us_bank_account");
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = await recordMarinaOnlinePayment({ companyId: company.id, invoiceId: rows[i].id, amount: rows[i].balance, reference: `autopay:${pi.id}:${i + 1}`, method: ach ? "ach" : "card", pending: !ok });
      if (!r.ok) console.error("autopay record failed", pi.id, r.error);
    }
  } catch (e: any) { console.error("autopay record error", pi.id, e?.message); }
  await supabaseAdmin.from("marina_autopay_attempts").update({ status: ok ? "succeeded" : "processing" }).eq("id", attemptId);
  await supabaseAdmin.from("marina_members").update({ autopay_failed_at: null, autopay_fail_note: null }).eq("id", m.id).eq("company_id", company.id);
  await mailBoater(company, m.email, `Autopay: ${money(charge)} ${ok ? "paid" : "is on its way from your bank"}`, ok ? "Payment received, thank you!" : "Bank payment started", [
    `We charged ${esc(m.autopay_label || "your saved payment method")} <b>${money(charge)}</b> for ${rows.map((r) => esc(r.invoice_number)).join(", ")}${fee ? ` (includes a ${money(fee)} processing fee)` : ""}.`,
    ok ? "Your receipt is in your boater account." : "Bank payments take 3 to 5 business days to clear.",
  ], { label: "Open my account", url: `https://${company.domain}/marina/account` }).catch(() => null);
  return { status: ok ? ("succeeded" as const) : ("processing" as const), amount: round2(rows.reduce((a, r) => a + r.balance, 0)) };
}

// A bank autopay payment bounced: reopen the invoices, tell the boater and the office, and pause
// bank autopay after the second bounce in 60 days (bank rules allow only limited retries).
export async function autopayBankFailed(companyId: string, piId: string, reason: string, opts?: { neverSubmitted?: boolean; paymentCreated?: number | null; paymentRule?: unknown }) {
  // Oct 28 (review): the boater's autopay terms must have disclosed the returned-payment fee.
  const { data: att0 } = await supabaseAdmin.from("marina_autopay_attempts").select("member_id").eq("company_id", companyId).eq("payment_intent_id", piId).limit(1);
  const auth0 = att0?.[0]?.member_id ? await loadAutopayAuthorizationRule("marina_members", att0[0].member_id, companyId) : { authorizedAt: null, rule: null };
  const returnedFee = await failMarinaAchPayment(companyId, `autopay:${piId}`, reason, {
    neverSubmitted: opts?.neverSubmitted, paymentCreated: opts?.paymentCreated ?? null, autopayAuthorizedAt: auth0.authorizedAt,
    paymentRule: opts?.paymentRule, authorizationRule: auth0.rule,
  });
  const { data: a } = await supabaseAdmin.from("marina_autopay_attempts").update({ status: "failed", error: reason.slice(0, 300) }).eq("company_id", companyId).eq("payment_intent_id", piId).neq("status", "failed").select("member_id");
  const memberId = a?.[0]?.member_id;
  if (!memberId) return;
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { count } = await supabaseAdmin.from("marina_autopay_attempts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("member_id", memberId).eq("method", "ach").eq("status", "failed").gte("created_at", since);
  const pause = (count || 0) >= 2;
  const { data: m } = await supabaseAdmin.from("marina_members").update({ autopay_failed_at: new Date().toISOString(), autopay_fail_note: `Bank payment returned: ${reason}`.slice(0, 300), ...(pause ? { autopay_enabled: false } : {}) }).eq("id", memberId).eq("company_id", companyId).select("full_name, email, autopay_label").maybeSingle();
  const { getMarinaById } = await import("./company");
  const company = await getMarinaById(companyId);
  if (!company || !m) return;
  await mailBoater(company, m.email, "Your bank returned the autopay payment", "Your bank returned the payment", [
    `Your bank didn't complete the autopay payment from ${esc(m.autopay_label || "your account")}: ${esc(reason)}. The invoices are open again.${returnedFee ? ` A returned-payment fee of ${money(returnedFee.total)} (${esc(returnedFee.description)}) was added to your account as its own invoice.` : ""}`,
    pause ? "Autopay is paused after two returned payments. Please pay in your account and turn autopay on again with a card or another account." : "Please make sure the account has funds, or pay in your account.",
  ], { label: "Open my account", url: `https://${company.domain}/marina/account#autopay` });
  await mailOffice(company, `Autopay bank payment returned: ${m.full_name}`, [`${esc(m.full_name)}'s bank returned an autopay payment (${esc(reason)}). The invoices are open again.${pause ? " Autopay was paused after the second return." : ""}`], undefined, "payments");
}

// Pending bank payments and stuck attempts: ask Stripe and settle, record or fail them.
export async function reconcileAutopay() {
  if (!stripe) return 0;
  let n = 0;
  const { data } = await supabaseAdmin.from("marina_autopay_attempts").select("id, company_id, payment_intent_id").eq("status", "processing").not("payment_intent_id", "is", null).limit(200);
  for (const a of data || []) {
    const pi = await stripe.paymentIntents.retrieve(a.payment_intent_id).catch(() => null);
    if (!pi) continue;
    if (pi.status === "succeeded") { await settleMarinaAchPayment(a.company_id, `autopay:${pi.id}`); await supabaseAdmin.from("marina_autopay_attempts").update({ status: "succeeded" }).eq("id", a.id); n++; }
    else if (pi.status === "requires_payment_method" || pi.status === "canceled") { await autopayBankFailed(a.company_id, pi.id, pi.last_payment_error?.message || "the bank declined the transfer", { neverSubmitted: pi.status === "canceled", paymentCreated: pi.created, paymentRule: pi.metadata?.returned_fee_rule }); n++; }
  }
  // Attempts that never got their payment id saved (the run stopped right after charging): find
  // the payment in Stripe by attempt id; record it if money moved, otherwise close the attempt.
  const old = new Date(Date.now() - 30 * 60000).toISOString();
  const { data: stuck } = await supabaseAdmin.from("marina_autopay_attempts").select("*").eq("status", "processing").is("payment_intent_id", null).lt("created_at", old).limit(50);
  for (const a of stuck || []) {
    const found = await stripe.paymentIntents.search({ query: `metadata['attempt_id']:'${a.id}'`, limit: 1 }).catch(() => null);
    const pi = found?.data[0];
    if (!pi || !["succeeded", "processing"].includes(pi.status)) {
      await supabaseAdmin.from("marina_autopay_attempts").update({ status: "failed", error: pi ? `Payment ${pi.status}` : "Not charged", payment_intent_id: pi?.id || null }).eq("id", a.id);
      continue;
    }
    await supabaseAdmin.from("marina_autopay_attempts").update({ payment_intent_id: pi.id }).eq("id", a.id);
    const allocs = String(pi.metadata?.allocs || "").split(";").map((x) => x.split(":")).filter((x) => x.length === 2);
    const { data: invs } = await supabaseAdmin.from("marina_invoices").select("id, invoice_number").eq("company_id", a.company_id).in("id", allocs.map((x) => x[0]).concat(["00000000-0000-0000-0000-000000000000"]));
    const rows = allocs.map(([id, amt]) => ({ id, balance: Number(amt), invoice_number: (invs || []).find((i: any) => i.id === id)?.invoice_number || "invoice" }));
    const { getMarinaById } = await import("./company");
    const company = await getMarinaById(a.company_id);
    const { data: m } = await supabaseAdmin.from("marina_members").select("*").eq("id", a.member_id).eq("company_id", a.company_id).maybeSingle();
    if (company && m) { await afterCharge(company, m, a.id, pi, rows, pi.amount / 100, Number(a.fee || 0)); n++; }
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
    ].filter(Boolean), undefined, "payments");
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: "Autopay", update_type: "autopay_run", message: `Autopay today: ${done.length} paid${failed.length ? `, ${failed.length} failed (${failed.map((f) => f.name).join(", ")})` : ""}.` }).then(() => null, () => null);
  }
  return { paid: done.length, failed: failed.length };
}

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v: unknown) => String(v ?? "").replace(/[<>&"]/g, "");
