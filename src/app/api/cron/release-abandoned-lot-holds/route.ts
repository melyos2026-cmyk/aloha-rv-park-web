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
  // Oct 26 (security review): fail closed — with CRON_SECRET unset, "Bearer undefined" used to work.
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Oct 28 (per Mely): tidy up expired 36-minute checkout holds (rv_lots.checkout_hold_*). An expired
  // hold already counts as free everywhere — this only clears the leftover values. Skipped quietly
  // until lot_checkout_hold.sql has been run.
  let checkoutHoldsCleared = 0;
  {
    const { data: cleared, error: holdErr } = await supabaseAdmin
      .from("rv_lots")
      .update({ checkout_hold_ref: null, checkout_hold_until: null, checkout_hold_session_id: null })
      .lt("checkout_hold_until", new Date().toISOString())
      .select("id");
    if (holdErr && !/checkout_hold_|42703|PGRST204/.test(`${holdErr.code} ${holdErr.message}`)) {
      console.error("release-abandoned-lot-holds: could not clear expired checkout holds:", holdErr.message);
    }
    checkoutHoldsCleared = (cleared || []).length;
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
    return NextResponse.json({ released: 0, checkoutHoldsCleared });
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

  return NextResponse.json({ released: released.length, details: released, checkoutHoldsCleared });
}
