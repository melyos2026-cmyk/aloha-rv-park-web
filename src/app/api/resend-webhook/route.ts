import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";

// POST /api/resend-webhook
// Sep 20 (per Mely — system health / error detection): Resend sends
// events here (bounced, delivery_delayed, complained, failed) for every
// email this system sends across BOTH repos (the "from" address is
// always noreply@aloharvparkfl.com either way) — logs a
// system_health_issue so a bounced invoice/notification email is never
// silently lost. Verified via Svix per Resend's own webhook docs;
// RESEND_WEBHOOK_SECRET must be set to the signing secret shown when
// this endpoint is registered in the Resend dashboard (Webhooks →
// Add Endpoint → this URL).
const RELEVANT_EVENT_TYPES = new Set([
  "email.bounced",
  "email.delivery_delayed",
  "email.complained",
  "email.failed",
]);

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (webhookSecret) {
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: "Missing Svix headers." }, { status: 400 });
    }
    try {
      new Webhook(webhookSecret).verify(payload, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      });
    } catch (err) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  } else {
    // No secret configured yet — accept unverified so this can be
    // wired up before the dashboard step is done, but this should be
    // set as soon as possible (see comment above).
    console.warn("RESEND_WEBHOOK_SECRET not set — accepting unverified Resend webhook payload.");
  }

  const event = JSON.parse(payload);
  if (!RELEVANT_EVENT_TYPES.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const toEmail = Array.isArray(event.data?.to) ? event.data.to[0] : event.data?.to;
  let companyId: string | null = null;
  let residentId: string | null = null;

  if (toEmail) {
    const { data: resident } = await supabaseAdmin
      .from("resident_accounts")
      .select("id, company_id")
      .eq("email", toEmail)
      .maybeSingle();
    if (resident) {
      companyId = resident.company_id;
      residentId = resident.id;
    }
  }

  // Falls back to the one-company assumption (Aloha) only if no
  // resident match was found, so this never gets silently dropped —
  // once a second real company exists, this fallback should be
  // reconsidered (look up by the "from" domain instead).
  if (!companyId) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id")
      .eq("park_id", "aloha")
      .maybeSingle();
    companyId = company?.id || null;
  }

  if (companyId) {
    await logSystemHealthIssue({
      companyId,
      issueType: "email_failed",
      residentId,
      message: `Email "${event.data?.subject || "(no subject)"}" to ${toEmail || "unknown recipient"} — ${event.type.replace("email.", "").replace("_", " ")}.`,
      source: "resend_webhook",
    });
  }

  return NextResponse.json({ received: true });
}
