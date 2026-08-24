import { NextRequest, NextResponse } from "next/server";
import { sendCheckrInvitationsForApplication } from "@/lib/checkrInvitationFlow";

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

  const result = await sendCheckrInvitationsForApplication(applicationId);
  if (!result.success) {
    return NextResponse.json({ error: result.error || "Could not send background check invitations." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    checkrCostTotal: result.checkrCostTotal,
    aggregateStatus: result.aggregateStatus,
  });
}
