import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 24 (security run): a card rental booking is real only once paid. Until then it holds its
// units for 40 minutes at most (see unitsFree) and the office isn't told about it. This runs when
// the payment is recorded: it tells the office, once.
export async function rentalPaidForInvoice(companyId: string, invoiceId: string) {
  const { data: b, error } = await supabaseAdmin.from("rental_bookings").select("id, booking_number, customer_name, total, payment, status, notes")
    .eq("company_id", companyId).eq("invoice_id", invoiceId).maybeSingle();
  if (error || !b || b.payment !== "card" || b.status === "cancelled") return;
  // Claim: only the first call for this booking sends the notice.
  const { data: claimed } = await supabaseAdmin.from("rental_bookings").update({ status_by_name: "Customer (paid online)" })
    .eq("id", b.id).eq("company_id", companyId).is("status_by_name", null).select("id");
  if (!claimed?.length) return;
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: companyId, resident_name: b.customer_name, update_type: "rental_booking",
    message: `New booking ${b.booking_number} — paid online ($${Number(b.total || 0).toFixed(2)}).`,
  }).then(() => null, () => null);
}
