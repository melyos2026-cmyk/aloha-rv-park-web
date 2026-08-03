import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// GET /api/portal/payment-history?residentId=...&days=30|60|90|180
//   or &month=2026-08 (specific calendar month) or &year=2026 (whole year)
// SECURITY (Aug 3, found while building #15): this page previously read
// resident_payments directly with the anon key, keyed off a bare
// localStorage resident_id with no session check at all — same gap as the
// occupants/vehicles bug, just never migrated in that earlier pass. Now
// requires the signed session cookie to match residentId.
export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const days = req.nextUrl.searchParams.get("days");
  const month = req.nextUrl.searchParams.get("month"); // "YYYY-MM"
  const year = req.nextUrl.searchParams.get("year"); // "YYYY"

  let query = supabase
    .from("resident_payments")
    .select("*")
    .eq("resident_id", residentId)
    .eq("status", "Paid")
    .order("payment_date", { ascending: false });

  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);
    query = query
      .gte("payment_date", start.toISOString().split("T")[0])
      .lt("payment_date", end.toISOString().split("T")[0]);
  } else if (year) {
    const y = Number(year);
    query = query
      .gte("payment_date", `${y}-01-01`)
      .lt("payment_date", `${y + 1}-01-01`);
  } else if (days) {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    query = query.gte("payment_date", since.toISOString().split("T")[0]);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ payments: data || [] });
}
