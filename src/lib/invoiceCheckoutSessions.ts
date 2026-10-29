import Stripe from "stripe";

// Oct 29 (live-money audit M14): before a NEW checkout for RV invoices is opened (resident portal
// "Pay Now" or the no-login guest link), every other still-open checkout that could pay ANY of the
// same invoices is closed — both directions: a guest link closes the resident's open portal checkout
// for that invoice, and a portal checkout closes open guest-link checkouts for its invoices. So an
// old tab can never pay the same invoice a second time.
// Stripe can't search sessions by metadata; this lists open sessions of the last 24 hours (invoice
// checkouts expire after 31 minutes, so that covers all of them). Tagged "superseded" first, so the
// webhook's checkout.session.expired never reports it as a failed payment. Best-effort.
export async function closeOtherInvoiceCheckouts(stripe: Stripe, p: { invoiceIds: string[]; residentId: string | null | undefined }) {
  const wanted = new Set(p.invoiceIds.filter(Boolean));
  try {
    const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    let seen = 0;
    for await (const old of stripe.checkout.sessions.list({ status: "open", created: { gte: since }, limit: 100 })) {
      if (++seen > 1000) break;
      const m = old.metadata || {};
      if (m.type || m.productId || !m.invoice_ids) continue; // only RV invoice checkouts
      const ids = String(m.invoice_ids).split(",").filter(Boolean);
      const overlaps = ids.some((id) => wanted.has(id));
      const samePortalResident = m.source === "portal" && !!p.residentId && m.resident_id === p.residentId;
      if (!overlaps && !samePortalResident) continue;
      await stripe.checkout.sessions.update(old.id, { metadata: { ...m, superseded: "1" } }).catch(() => null);
      await stripe.checkout.sessions.expire(old.id).catch(() => null);
    }
  } catch (e: any) {
    console.error("closeOtherInvoiceCheckouts:", e?.message);
  }
}
