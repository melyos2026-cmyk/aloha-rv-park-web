import { NextRequest, NextResponse } from "next/server";
import { sendCheckrInvitationsForApplication } from "@/lib/checkrInvitationFlow";
import { supabaseAdmin } from "@/lib/supabase-admin";

// POST /api/send-checkr-invitations-for-application
// Aug 24 (per Mely — found live: paying the application fee in person
// via "Mark Fee Collected" never sent the Checkr invitation at all, and
// never calculated what the company owes MelyOS for that check). Called
// by melyos-builder's mark-application-fee-collected route (different
// repo/deployment) right after marking the fee collected, so the
// in-person path gets the exact same real background check + cost
// calculation the Stripe checkout path already gets automatically.
export async function POST(req: NextRequest) {
  const { applicationId } = await req.json();
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  // Oct 20 (security review): this public route had no auth at all — anyone
  // could trigger real (paid) Checkr background checks for any application,
  // over and over. Without adding a new shared secret between the two apps,
  // it now only runs when it can only ever be legitimate: the application
  // fee has ALREADY been marked collected (melyos-builder's Mark Fee
  // Collected sets that right before calling here) AND no invitation has
  // been sent yet for this application. Repeat calls get a 409.
  const { data: app, error: appError } = await supabaseAdmin
    .from("resident_applications")
    .select("id, application_fee_paid, checkr_invitation_sent_at, checkr_results")
    .eq("id", applicationId)
    .maybeSingle();
  if (appError || !app) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (app.application_fee_paid !== true) {
    return NextResponse.json(
      { error: "The application fee hasn't been marked as collected yet." },
      { status: 409 }
    );
  }
  const alreadySent =
    !!app.checkr_invitation_sent_at ||
    (Array.isArray(app.checkr_results) &&
      app.checkr_results.some((r: any) => r && r.status && r.status !== "invitation_failed"));
  if (alreadySent) {
    return NextResponse.json(
      { error: "Background check invitations were already sent for this application." },
      { status: 409 }
    );
  }

  // Oct 26 (security review): claim the send atomically — only the one request that flips
  // checkr_invitation_sent_at from empty gets to send. Two calls at the same moment used to both
  // pass the check above and both order (paid) background checks.
  const claimAt = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from("resident_applications")
    .update({ checkr_invitation_sent_at: claimAt })
    .eq("id", applicationId)
    .eq("application_fee_paid", true)
    .is("checkr_invitation_sent_at", null)
    .select("id");
  if (!claimed?.length) {
    return NextResponse.json(
      { error: "Background check invitations were already sent for this application." },
      { status: 409 }
    );
  }
  // If nothing was actually sent, give the claim back so the office can retry (as before).
  const releaseClaim = () =>
    supabaseAdmin
      .from("resident_applications")
      .update({ checkr_invitation_sent_at: null })
      .eq("id", applicationId)
      .eq("checkr_invitation_sent_at", claimAt)
      .then(() => null, () => null);

  let result: Awaited<ReturnType<typeof sendCheckrInvitationsForApplication>>;
  try {
    result = await sendCheckrInvitationsForApplication(applicationId);
  } catch (e) {
    await releaseClaim();
    throw e;
  }
  if (!result.success) {
    await releaseClaim();
    return NextResponse.json({ error: result.error || "Could not send background check invitations." }, { status: 500 });
  }
  // checkrCostTotal is 0 only when every invitation failed (the flow then leaves sent_at alone).
  if (!result.checkrCostTotal) await releaseClaim();

  return NextResponse.json({
    success: true,
    checkrCostTotal: result.checkrCostTotal,
    aggregateStatus: result.aggregateStatus,
  });
}
