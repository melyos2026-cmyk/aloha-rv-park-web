import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { startInvoicePayment } from "@/lib/marina/checkout";
import { loadBookingByLink, bookingMoney } from "@/lib/marina/booking";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

// POST /api/marina/reservation { id, t } — Oct 26 (per Mely): the guest pays the balance of a
// booking from its private page (the link in the confirmation email). No account needed.
export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `resvpay:${company.id}`, 10)) return NextResponse.json({ error: "Too many tries. Please call the dock office." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const r = await loadBookingByLink(company.id, String(b.id || ""), String(b.t || ""));
  if (!r) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (r.status !== "confirmed") return NextResponse.json({ error: r.status === "cancelled" ? "This booking was cancelled." : "Pay the deposit first." }, { status: 409 });
  const m = await bookingMoney(company.id, r);
  if (!m.balanceInvoiceId || !(m.balanceLeft > 0)) return NextResponse.json({ error: "Nothing is due on this booking." }, { status: 400 });
  const page = `https://${company.domain}/marina/reservation/${r.id}?t=${r.access_token}`;
  const pay = await startInvoicePayment({ company, invoiceId: m.balanceInvoiceId, successUrl: `${page}&paid=1`, cancelUrl: page });
  if (!pay.ok) return NextResponse.json({ error: pay.error }, { status: pay.status });
  return NextResponse.json("url" in pay ? { url: pay.url } : { ok: true, demo: true });
}
