import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { loadReturnedFeeSettings, melyosShareOfReturnedFee, returnedFeeForReturn, billCompanyForReturnedPayment } from "@/lib/platformFee";
import { round2, todayET } from "./data";
import { isDemoCompany } from "./host";
import { mailBoater } from "./slipAuto";
import { claimStripeEvent, finishStripeEvent } from "@/lib/stripeEventClaim";

// Oct 28 (per Mely — owner-approved): when a boater's bank (ACH) payment is RETURNED, the marina's own
// returned-payment fee rule (company_fee_settings — Florida standard, or the marina's fee schedule, e.g.
// Fla. Stat. 215.34 "$15 or 5%, whichever is greater") becomes its own invoice for the boater
// (category "returned_payment_fee"). Once per returned payment: the invoice number is derived from the
// Stripe payment ("ACHRET-<last 12 chars>"), so a repeat event hits the unique invoice number and adds
// nothing. When the boater pays it online, MelyOS's share goes to MelyOS (marinaReturnedFeeMelyosPart).
export const MARINA_RETURNED_FEE_PREFIX = "ACHRET-";
export const isAutoReturnedFeeInvoice = (inv: { invoice_number?: string | null; category?: string | null } | null | undefined) =>
  !!inv && String(inv.invoice_number || "").startsWith(MARINA_RETURNED_FEE_PREFIX) && inv.category === "returned_payment_fee";

// paymentCreated: when the returned payment was made (Stripe `created`); autopayAuthorizedAt: for autopay,
// when the boater accepted the autopay terms. Payments/authorizations from before the marina's fee was
// disclosed (MARINA_RETURNED_FEE_DISCLOSED_SINCE) get NO fee.
// paymentRule / authorizationRule: the rule frozen on the payment (Stripe metadata) / with the autopay
// authorization — used first; a higher current rule is never used instead.
export async function ensureMarinaReturnedFeeInvoice(companyId: string, reference: string, timing: { paymentCreated: number | string | null; autopayAuthorizedAt?: string | null; paymentRule?: unknown; authorizationRule?: unknown; paymentIntentId?: string | null }): Promise<{ total: number; description: string } | null> {
  try {
    // The bank payment rows this reference returned (one payment can cover several invoices).
    const { data: rows, error } = await supabaseAdmin
      .from("marina_invoice_payments")
      .select("invoice_id, amount, method, returned_at, return_reason")
      .eq("company_id", companyId)
      .or(`reference.eq.${reference},reference.like.${reference}:%`)
      .not("returned_at", "is", null);
    if (error) throw new Error(error.message);
    const returned = (rows || []).filter((r: any) => r.method === "ach" && String(r.return_reason || "").startsWith("Bank payment failed"));
    if (returned.length === 0) return null;
    const invoiceAmount = round2(returned.reduce((a: number, r: any) => a + Number(r.amount || 0), 0));
    if (!(invoiceAmount > 0)) return null;
    const [{ data: company }, { data: first }] = await Promise.all([
      supabaseAdmin.from("companies").select("company_name, domain, is_demo").eq("id", companyId).maybeSingle(),
      supabaseAdmin.from("marina_invoices").select("member_id, customer_name, customer_email, slip_id").eq("company_id", companyId).eq("id", returned[0].invoice_id).maybeSingle(),
    ]);
    // Oct 28 (per Mely — new model): MelyOS bills the marina its fixed charge for this returned payment
    // (once per PaymentIntent; whether or not the boater pays — and even if no fee was disclosed to them).
    // The billing row names the boater (member name, else the invoice's customer name).
    let payerName: string | null = first?.customer_name ?? null;
    if (first?.member_id) {
      const { data: mem } = await supabaseAdmin.from("marina_members").select("full_name").eq("id", first.member_id).eq("company_id", companyId).maybeSingle();
      payerName = mem?.full_name || payerName;
    }
    await billCompanyForReturnedPayment({ companyId, kind: "marina", payerName, amount: invoiceAmount, paymentIntentId: timing.paymentIntentId || (reference.startsWith("autopay:") ? reference.slice(8) : null) });
    if (!company || isDemoCompany(company as any)) return null;
    const fee = await returnedFeeForReturn({
      kind: "marina", companyId, companyName: company.company_name, invoiceAmount,
      paymentRule: timing.paymentRule, authorizationRule: timing.authorizationRule,
      paymentCreated: timing.paymentCreated, ...("autopayAuthorizedAt" in timing ? { autopayAuthorizedAt: timing.autopayAuthorizedAt ?? null } : {}),
    });
    if (!fee) return null; // not disclosed for this payment, or the rule couldn't be read (System Health told)
    const tail = reference.replace(/[^A-Za-z0-9]/g, "").slice(-12);
    const today = todayET();
    const feeRow: Record<string, unknown> = {
      company_id: companyId,
      invoice_number: `${MARINA_RETURNED_FEE_PREFIX}${tail}`,
      category: "returned_payment_fee",
      member_id: first?.member_id ?? null,
      customer_name: first?.customer_name ?? null,
      customer_email: first?.customer_email ?? null,
      slip_id: first?.slip_id ?? null,
      description: fee.description.slice(0, 300),
      amount: fee.total,
      issue_date: today,
      due_date: today,
      melyos_share: fee.melyosShare, // frozen now (marina_invoices.melyos_share — returned_fee_settings.sql)
    };
    let { error: insErr } = await supabaseAdmin.from("marina_invoices").insert(feeRow);
    if (insErr && (insErr.code === "42703" || insErr.code === "PGRST204" || /melyos_share/.test(insErr.message || ""))) {
      delete feeRow.melyos_share;
      ({ error: insErr } = await supabaseAdmin.from("marina_invoices").insert(feeRow));
    }
    if (insErr && insErr.code !== "23505") throw new Error(insErr.message);
    return { total: fee.total, description: fee.description };
  } catch (e: any) {
    await logSystemHealthIssue({
      companyId, issueType: "marina_online_payment_returned", source: "stripe",
      message: `A boater's bank payment (${reference}) was returned, but the returned-payment fee invoice could not be created (${String(e?.message || "error").slice(0, 200)}). Add it by hand if it applies.`,
    }).catch(() => null);
    return null;
  }
}

// MelyOS's part of what is being paid online on these invoices (balance = what this payment pays on
// each). Only the automatic returned-payment fee invoices count; fees the office adds by hand are the
// marina's. Best-effort: on a lookup error it returns 0 (as before) and tells System Health.
export async function marinaReturnedFeeMelyosPart(companyId: string, rows: { id: string; balance: number }[]): Promise<number> {
  const ids = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return 0;
  // MelyOS's share frozen on the fee invoice; the current setting only for invoices made before that column.
  let { data, error } = await supabaseAdmin.from("marina_invoices").select("id, invoice_number, category, amount, melyos_share").eq("company_id", companyId).in("id", ids) as { data: any[] | null; error: any };
  if (error && (error.code === "42703" || error.code === "PGRST204" || /melyos_share/.test(error.message || ""))) {
    ({ data, error } = await supabaseAdmin.from("marina_invoices").select("id, invoice_number, category, amount").eq("company_id", companyId).in("id", ids) as any);
  }
  if (error) {
    await logSystemHealthIssue({ companyId, issueType: "melyos_fee_split", source: "stripe", message: `Could not check invoices ${ids.join(", ")} for a returned-payment fee before charging (${error.message}). If one is there, MelyOS's share went to the marina.` }).catch(() => null);
    return 0;
  }
  const fees = (data || []).filter(isAutoReturnedFeeInvoice);
  if (fees.length === 0) return 0;
  const settings = fees.some((f: any) => f.melyos_share == null) ? await loadReturnedFeeSettings(companyId, "marina") : null;
  let part = 0;
  for (const inv of fees) {
    // MelyOS's share is paid first: what earlier payments on this fee already covered of it is not counted again.
    const bal = Math.max(Number(rows.find((r) => r.id === inv.id)?.balance || 0), 0);
    const share = (inv as any).melyos_share != null && Number.isFinite(Number((inv as any).melyos_share))
      ? Math.min(Number(inv.amount) || 0, Math.max(Number((inv as any).melyos_share), 0))
      : melyosShareOfReturnedFee(settings!, Number(inv.amount) || 0);
    const paidBefore = Math.max(round2((Number(inv.amount) || 0) - bal), 0);
    part += Math.min(bal, Math.max(0, share - Math.min(paidBefore, share)));
  }
  return round2(part);
}

// Oct 28 (per Mely): a boater's ONE-TIME bank (ACH) payment was returned — tell the boater (same
// branded marina email as the autopay-return one): amount, the reason in plain words, the invoice(s)
// owed again, and the returned-payment fee invoice ONLY if one was really created (amount + rule).
// Once per payment (marker "marina_ach_return_email:<session>"); never for demo marinas (mailBoater).
export async function emailBoaterBankPaymentReturned(p: {
  companyId: string; sessionId: string; reference: string; amount: number;
  reasonCode?: string | null; reasonMessage?: string | null;
  fee: { total: number; description: string } | null;
}) {
  try {
    const { getMarinaById } = await import("./company");
    const company = await getMarinaById(p.companyId);
    if (!company || isDemoCompany(company)) return;
    const { data: rows } = await supabaseAdmin.from("marina_invoice_payments").select("invoice_id")
      .eq("company_id", p.companyId).or(`reference.eq.${p.reference},reference.like.${p.reference}:%`).not("returned_at", "is", null);
    const ids = [...new Set((rows || []).map((r: any) => r.invoice_id))];
    if (ids.length === 0) return;
    const { data: invs } = await supabaseAdmin.from("marina_invoices").select("invoice_number, member_id, customer_email").eq("company_id", p.companyId).in("id", ids);
    const first: any = (invs || [])[0];
    let to: string = first?.customer_email || "";
    if (first?.member_id) {
      const { data: m } = await supabaseAdmin.from("marina_members").select("email").eq("id", first.member_id).eq("company_id", p.companyId).maybeSingle();
      to = m?.email || to;
    }
    if (!to) return;
    const marker = `marina_ach_return_email:${p.sessionId}`;
    if ((await claimStripeEvent(marker, "lot_checkout")) === "duplicate") return;
    const { plainAchReason } = await import("@/lib/sendBankPaymentReturnedEmail");
    const reason = plainAchReason(p.reasonCode, p.reasonMessage);
    const esc = (v: string) => String(v).replace(/[<>&"]/g, "");
    const nums = (invs || []).map((i: any) => esc(i.invoice_number)).join(", ");
    const ok = await mailBoater(company, to, `Your bank returned your payment of $${p.amount.toFixed(2)}`, "Your bank returned the payment", [
      `Your bank (ACH) payment of <b>$${p.amount.toFixed(2)}</b> was returned by your bank${reason ? ` because ${esc(reason)}` : ""}. The money was not collected.`,
      `${(invs || []).length === 1 ? "Invoice" : "Invoices"} ${nums} ${(invs || []).length === 1 ? "is" : "are"} open again and owed.`,
      ...(p.fee ? [`A returned-payment fee of <b>$${p.fee.total.toFixed(2)}</b> (${esc(p.fee.description)}) was added to your account as its own invoice.`] : []),
      "Please pay in your boater account. If you think this is a mistake, check with your bank first, then contact the office.",
    ], { label: "Open my account", url: `https://${company.domain}/marina/account` });
    await finishStripeEvent(marker, "lot_checkout", ok);
  } catch (e: any) {
    console.error("emailBoaterBankPaymentReturned:", e?.message);
  }
}
