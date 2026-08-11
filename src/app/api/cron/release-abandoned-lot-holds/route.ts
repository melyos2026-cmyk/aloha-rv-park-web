import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

// GET /api/cron/release-abandoned-lot-holds
// Aug 11 (per Mely): the moment an applicant pays, their lot is pulled
// from 'available' immediately (stripe-webhook.ts's handleApplicationFeePaid)
// so a second applicant can't also pay a non-refundable background check
// fee for a lot that's already spoken for. But if THIS application then
// just sits there — nobody ever approves or rejects it — the lot would
// stay held forever with no one able to apply for it. Runs daily: any
// application that paid the fee 10+ days ago, is still 'Pending' (never
// approved), and isn't archived, gets its held lot released back to
// 'available' (only if it's still 'reserved' — never touches a lot that
// became genuinely occupied by someone else since). The application
// itself is untouched — admin can still review/approve it later, they'd
// just need to confirm the lot (or a different one) is still free.
const ABANDONED_HOLD_DAYS = 6;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ABANDONED_HOLD_DAYS);

  const { data: abandoned, error } = await supabaseAdmin
    .from("resident_applications")
    .select("id, space_id, full_name, company_id")
    .eq("application_fee_paid", true)
    .eq("status", "Pending")
    .eq("archived", false)
    .not("space_id", "is", null)
    .lt("application_fee_paid_at", cutoff.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!abandoned || abandoned.length === 0) {
    return NextResponse.json({ released: 0 });
  }

  const released: string[] = [];

  for (const app of abandoned) {
    const { data: lot, error: lotError } = await supabaseAdmin
      .from("rv_lots")
      .update({ status: "available" })
      .eq("id", app.space_id)
      .eq("status", "reserved")
      .select("id, lot_name")
      .maybeSingle();

    if (lotError) {
      console.error(`Could not release lot for application ${app.id}:`, lotError.message);
      continue;
    }
    if (lot) {
      released.push(`${lot.lot_name} (application ${app.id})`);
    }
  }

  return NextResponse.json({ released: released.length, details: released });
}
