import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 21 (per Mely — security hardening): Stripe can deliver the same event more
// than once (retries for up to 3 days). Each event is claimed once per endpoint
// in stripe_processed_events, so a payment is never recorded twice.
// Fails open: if the table doesn't exist yet, processing simply continues.
// Returns "duplicate" when this event was already handled (or is being handled).
export async function claimStripeEvent(eventId: string, source: string): Promise<"new" | "duplicate"> {
  const { error } = await supabaseAdmin.from("stripe_processed_events").insert({ event_id: eventId, source });
  if (!error) return "new";
  if (error.code !== "23505") return "new"; // table missing or other problem: don't block payments
  const { data } = await supabaseAdmin.from("stripe_processed_events").select("status, created_at").eq("event_id", eventId).eq("source", source).maybeSingle();
  if (!data) return "new";
  if (data.status === "done") return "duplicate";
  // Still "processing": a parallel delivery is working on it. If it's stuck (> 10 min), take it over.
  if (Date.now() - new Date(data.created_at).getTime() < 10 * 60 * 1000) return "duplicate";
  await supabaseAdmin.from("stripe_processed_events").update({ created_at: new Date().toISOString() }).eq("event_id", eventId).eq("source", source);
  return "new";
}

export async function finishStripeEvent(eventId: string, source: string, ok: boolean) {
  if (ok) await supabaseAdmin.from("stripe_processed_events").update({ status: "done", finished_at: new Date().toISOString() }).eq("event_id", eventId).eq("source", source).then(() => {}, () => {});
  // Failed: release the claim so Stripe's retry can process it again.
  else await supabaseAdmin.from("stripe_processed_events").delete().eq("event_id", eventId).eq("source", source).eq("status", "processing").then(() => {}, () => {});
}
