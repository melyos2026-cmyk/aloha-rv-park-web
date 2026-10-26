import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";
import { loadBookingSettings, residentPricingFor } from "@/lib/marina/booking";

// GET /api/marina/booking-terms — Oct 26 (per Mely): how online bookings are paid at this marina
// (all now, or a deposit now and the balance later) and whether the signed-in boater gets the
// resident rate. Used by the booking window and the slip finder to show the right prices.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const s = await getMarinaSession(req);
  const [terms, resident] = await Promise.all([
    loadBookingSettings(company.id),
    residentPricingFor(company.id, s && s.companyId === company.id ? s.memberId : null),
  ]);
  return NextResponse.json({ ...terms, resident }, { headers: { "Cache-Control": "private, no-store" } });
}
