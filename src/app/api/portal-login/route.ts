import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { getSecurityAlertPrefs } from "@/lib/securityAlertPrefs";
import { setPortalSessionCookie } from "@/lib/portalSession";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  const { data: resident, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, full_name, company_id, portal_password, portal_enabled, portal_access_ends_at")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !resident || !resident.portal_password) {
    // Log the attempt even if the email doesn't match a real account — still
    // useful history, just nothing to cross-reference yet.
    await supabaseAdmin.from("resident_login_attempts").insert({
      resident_id: resident?.id || null,
      attempted_email: email,
      ip,
      success: false,
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  // Aug 18 (per Mely — "como se ve el portal de Merarys ahora que
  // vendio?"): found a real gap while checking — portal_enabled=false
  // (set when a resident's home sells, or on any move-out) was never
  // actually enforced at login. Only 2 of 80+ /api/portal/* routes even
  // reference it, and none of them are login itself — meaning someone
  // whose access was supposed to have ended could still log in and see
  // almost everything, as long as they remembered their password. Fixed
  // at the one real chokepoint: block it right here, before a session
  // cookie is ever issued, so nothing downstream needs its own check.
  //
  // Aug 18 (continued, per Mely — "se puede dejar abierto por al menos
  // 7 dias ya que ellos tienen documentos que pueden printiar"): a home
  // sale specifically no longer disables portal_enabled at all — it sets
  // portal_access_ends_at (now + 7 days) instead, checked here too, so
  // the seller keeps real login access for a week to download/print
  // their documents before it actually cuts off.
  if (
    resident.portal_enabled === false ||
    (resident.portal_access_ends_at && new Date(resident.portal_access_ends_at) <= new Date())
  ) {
    await supabaseAdmin.from("resident_login_attempts").insert({
      resident_id: resident.id,
      attempted_email: email,
      ip,
      success: false,
    });
    return NextResponse.json(
      { error: "Your portal access has ended. Please contact the park office if you believe this is a mistake." },
      { status: 403 }
    );
  }

  // Aug 26 (per Mely — Rent-to-Own journey review, but applies to every
  // approval): the move-in "due now" invoice (rent + deposit, sent as
  // its own email right at approval — see
  // send-application-approved-invoice-email) is meant to be paid via
  // that email's no-login /pay-invoice link BEFORE the resident ever
  // gets portal access — Mely doesn't want someone able to poke around
  // the portal (and see next month's invoice) while still owing that
  // first charge.
  //
  // IMPORTANT SCOPE: this only ever applies to a resident who has NEVER
  // paid anything yet (their very first invoice, still unpaid) — an
  // established resident who later falls behind on rent must still be
  // able to log in and pay from their own portal as always; blocking
  // login on ANY overdue invoice would lock out every resident who's
  // ever late, which is a different (and much more disruptive) thing
  // than what was asked for here.
  const { count: everPaidCount } = await supabaseAdmin
    .from("resident_invoices")
    .select("id", { count: "exact", head: true })
    .eq("resident_id", resident.id)
    .eq("status", "Paid");

  if (!everPaidCount) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: dueNowInvoice } = await supabaseAdmin
      .from("resident_invoices")
      .select("id, invoice_month, total_amount, guest_payment_token")
      .eq("resident_id", resident.id)
      .eq("status", "Pending")
      .lte("due_date", todayStr)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (dueNowInvoice) {
      let payToken = dueNowInvoice.guest_payment_token;
      if (!payToken) {
        const { data: updated } = await supabaseAdmin
          .from("resident_invoices")
          .update({ guest_payment_token: crypto.randomUUID() })
          .eq("id", dueNowInvoice.id)
          .select("guest_payment_token")
          .single();
        payToken = updated?.guest_payment_token || null;
      }
      await supabaseAdmin.from("resident_login_attempts").insert({
        resident_id: resident.id,
        attempted_email: email,
        ip,
        success: false,
      });
      return NextResponse.json(
        {
          error: `Please pay your ${dueNowInvoice.invoice_month} invoice ($${Number(dueNowInvoice.total_amount || 0).toFixed(2)}) before accessing your resident portal.`,
          payUrl: payToken ? `/pay-invoice/${payToken}` : null,
        },
        { status: 402 }
      );
    }
  }

  const matches = await bcrypt.compare(password, resident.portal_password);

  await supabaseAdmin.from("resident_login_attempts").insert({
    resident_id: resident.id,
    attempted_email: email,
    ip,
    success: matches,
  });

  if (!matches) {
    // Only flag this after repeated failures — a single typo shouldn't
    // trigger a security alert. Count recent failed attempts (last 30 min)
    // on this specific account.
    const thirtyMinAgo = new Date(Date.now() - 1000 * 60 * 30).toISOString();
    const { count: recentFailCount } = await supabaseAdmin
      .from("resident_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("resident_id", resident.id)
      .eq("success", false)
      .gte("created_at", thirtyMinAgo);

    // Someone got the account's email right but the password wrong,
    // repeatedly. If this IP was previously used for a SUCCESSFUL login by a
    // DIFFERENT resident, that's a meaningful signal in this park
    // specifically (residents don't share internet here, except a couple of
    // known cases Mely is aware of). Only notify once, right when the count
    // crosses the threshold — not again on every attempt after.
    if (ip && recentFailCount === 3) {
      const { data: matchingLogin } = await supabaseAdmin
        .from("resident_login_attempts")
        .select("resident_id, resident_accounts(full_name)")
        .eq("ip", ip)
        .eq("success", true)
        .neq("resident_id", resident.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (matchingLogin && resident.company_id) {
        const prefs = await getSecurityAlertPrefs(resident.company_id);
        if (prefs.failedLogins) {
          const otherName = (matchingLogin as any).resident_accounts?.full_name || "another resident";
          const ipClause = prefs.includeIp
            ? ` came from an IP previously used for a successful login by ${otherName}. Could be shared internet — worth checking with both residents.`
            : ` may be a case of one resident trying to access ${otherName}'s account — worth checking with both residents.`;
          await supabaseAdmin.from("resident_update_notifications").insert({
            company_id: resident.company_id,
            resident_name: resident.full_name,
            update_type: "security_alert",
            message: `3 failed login attempts on ${resident.full_name}'s account${ipClause}`,
          });
        }
      }
    }

    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const res = NextResponse.json({ id: resident.id, full_name: resident.full_name });
  setPortalSessionCookie(res, resident.id, resident.company_id || null);
  return res;
}
