import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/portal/billing-info?residentId=...
// Returns the resident's next payment (due) date, computed from their
// Billing Profile's due_day — the next occurrence of that day-of-month
// from today.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");

  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const { data: profile } = await supabaseAdmin
    .from("resident_billing_profiles")
    .select("due_day")
    .eq("resident_id", residentId)
    .maybeSingle();

  if (!profile || !profile.due_day) {
    return NextResponse.json({ nextPaymentDate: null });
  }

  const dueDay = Number(profile.due_day);
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth(); // 0-indexed

  // If this month's due day has already passed, the next one is next month.
  if (today.getDate() > dueDay) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  // Clamp to the last real day of that month (e.g. due_day=31 in a 30-day month).
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const clampedDay = Math.min(dueDay, lastDayOfMonth);
  const nextPaymentDate = new Date(year, month, clampedDay);

  const label = nextPaymentDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return NextResponse.json({ nextPaymentDate: label });
}
