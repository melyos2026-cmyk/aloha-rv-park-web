import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sendResidentNotificationEmail } from "@/lib/sendResidentNotificationEmail";
import {
  verifyCheckrSignature,
  resolveCandidate,
  computeAggregateStatus,
  CheckrResultEntry,
} from "@/lib/checkr";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-checkr-signature");

  if (!verifyCheckrSignature(rawBody, signature)) {
    console.log("Checkr webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);
  const type = event.type as string;
  const data = event.data?.object;

  try {
    if (type === "invitation.completed") {
      await updatePersonStatus(data.candidate_id, "in_progress");
    }
    if (type === "invitation.expired") {
      await updatePersonStatus(data.candidate_id, "invitation_expired");
    }
    if (type === "report.completed") {
      const result = data.result as string | null;
      const status = result === "clear" ? "Passed" : "Needs Review";
      await updatePersonStatus(data.candidate_id, status);
    }
  } catch (err: any) {
    console.error("Checkr webhook handling error:", err.message);
  }

  return NextResponse.json({ received: true });
}

// Sep 28 (per Mely's Checkr-readiness review): Checkr's docs warn webhook
// delivery order isn't guaranteed. Without a rank check, a late/
// out-of-order invitation.completed ("in_progress") could silently
// overwrite a final report result (Passed/Needs Review) that already
// arrived. A final result, once set, can only be replaced by another
// final result (e.g. a later re-run), never downgraded back to a
// transitional state.
const STATUS_RANK: Record<string, number> = {
  Pending: 0,
  invitation_sent: 0,
  in_progress: 1,
  Passed: 2,
  "Needs Review": 2,
  Failed: 2,
  invitation_expired: 2,
  invitation_failed: 2,
};
function isRegression(currentStatus: string | undefined, newStatus: string): boolean {
  const currentRank = STATUS_RANK[currentStatus || ""] ?? -1;
  const newRank = STATUS_RANK[newStatus] ?? -1;
  return currentRank > newRank;
}

async function updatePersonStatus(candidateId: string | undefined, status: string) {
  if (!candidateId) return;

  const resolved = await resolveCandidate(candidateId);
  if (!resolved) {
    console.log(`Checkr webhook: could not resolve candidate ${candidateId} to an application`);
    return;
  }
  const { applicationId, personKey } = resolved;

  // Aug 4 (per Mely): Household Occupants added post-move-in use the
  // customId format "occupant::<occupantId>" (see
  // handleOccupantBackgroundCheckPaid in stripe-webhook) instead of the
  // "<applicationId>::<personKey>" format lease-application occupants
  // use — each occupant is its own row here, so no aggregate/multi-
  // person logic is needed, just a direct status update.
  if (applicationId === "occupant") {
    const occupantId = personKey;

    const { data: existingOccupant } = await supabase
      .from("resident_occupants")
      .select("background_check_status")
      .eq("id", occupantId)
      .maybeSingle();
    if (isRegression(existingOccupant?.background_check_status, status)) {
      console.log(`Checkr webhook: ignoring out-of-order "${status}" for occupant ${occupantId} (already "${existingOccupant?.background_check_status}")`);
      return;
    }

    const { data: updatedOccupant, error: occError } = await supabase
      .from("resident_occupants")
      .update({ background_check_status: status })
      .eq("id", occupantId)
      .select("full_name, resident_id")
      .maybeSingle();

    if (occError) {
      console.log(`Checkr webhook: could not update occupant ${occupantId}:`, occError.message);
      return;
    }

    // Aug 4 (per Mely): notify admin the moment Checkr gives a real
    // result — not for the transitional "in_progress" state, only once
    // there's something actually actionable (a pass/fail, or an expired
    // invitation) — same resident_update_notifications table/pattern the
    // bell already watches in real time, so this shows up instantly
    // without admin having to check anything manually.
    const isFinalResult = status === "Passed" || status === "Needs Review" || status === "invitation_expired";
    if (isFinalResult && updatedOccupant?.resident_id) {
      const { data: resident } = await supabase
        .from("resident_accounts")
        .select("company_id, full_name")
        .eq("id", updatedOccupant.resident_id)
        .maybeSingle();

      if (resident) {
        const resultLabel =
          status === "Passed" ? "passed" : status === "Needs Review" ? "needs review" : "invitation expired";
        await supabase.from("resident_update_notifications").insert({
          company_id: resident.company_id,
          resident_id: updatedOccupant.resident_id,
          resident_name: resident.full_name,
          update_type: "occupant_background_check_result",
          message: `Background check for ${updatedOccupant.full_name} (household occupant of ${resident.full_name}): ${resultLabel}.`,
          // Sep 18 (per Mely): this already notified the admin — now
          // also shows in the resident's own portal bell, since it's
          // about their own household.
          resident_facing: true,
        });
        await sendResidentNotificationEmail(
          updatedOccupant.resident_id,
          resident.company_id,
          `Background check for ${updatedOccupant.full_name} (household occupant): ${resultLabel}.`,
          "Household background check update"
        );
      }
    }

    console.log(`Household Occupant ${occupantId} -> ${status}`);
    return;
  }

  const { data: application, error } = await supabase
    .from("resident_applications")
    .select("checkr_results")
    .eq("id", applicationId)
    .single();

  if (error || !application) {
    console.log(`Checkr webhook: application ${applicationId} not found`);
    return;
  }

  const results: CheckrResultEntry[] = (application.checkr_results as CheckrResultEntry[]) || [];
  const existing = results.find((r) => r.personKey === personKey);
  if (isRegression(existing?.status, status)) {
    console.log(`Checkr webhook: ignoring out-of-order "${status}" for ${applicationId}/${personKey} (already "${existing?.status}")`);
    return;
  }
  const updated = results.map((r) =>
    r.personKey === personKey ? { ...r, status, candidateId } : r
  );
  if (!updated.some((r) => r.personKey === personKey)) {
    updated.push({ personKey, name: personKey, candidateId, status });
  }

  const aggregateStatus = computeAggregateStatus(updated);

  await supabase
    .from("resident_applications")
    .update({ checkr_results: updated, background_check_status: aggregateStatus })
    .eq("id", applicationId);

  console.log(
    `Application ${applicationId} — ${personKey} -> ${status} (aggregate: ${aggregateStatus})`
  );
}
