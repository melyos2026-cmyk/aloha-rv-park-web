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

  // Sep 29 (per Mely — found live: root cause was a stray trailing
  // character in the CHECKR_API_KEY Vercel env var, fixed by re-entering
  // the key). Temporary diagnostic logging removed now that the real
  // mismatch is confirmed and resolved.
  if (!verifyCheckrSignature(rawBody, signature)) {
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
      // Sep 30 (per Mely — wants the full report viewable from the
      // admin): the Report object's own id, captured here so the admin
      // can deep-link straight to it on Checkr's dashboard.
      // Oct 1 (per Checkr's Report Lifecycle certification requirement):
      // includes_canceled — true when SOME (not all) of this report's
      // screenings were canceled even though the report still completed
      // with a real result. Passed through so the admin UI can show that
      // caveat instead of presenting it as a fully clean result.
      await updatePersonStatus(data.candidate_id, status, data.id, !!data.includes_canceled);
    }
    // Oct 1 (per Checkr's Report Lifecycle certification requirement):
    // fires when ALL screenings on a report are canceled — distinct from
    // includes_canceled above (some screenings), this report never
    // produced any usable result at all. Must be surfaced as its own
    // final status, same urgency as invitation_failed/invitation_expired.
        if (type === "report.canceled") {
      await updatePersonStatus(data.candidate_id, "Canceled", data.id);
    }
    // Oct 2 (per Mely — found live: Checkr emailed a candidate directly
    // ("Background check paused: more information needed") with no
    // notice to the admin at all — admin had no way to know the
    // candidate needed to go verify something in their Checkr candidate
    // portal, or to follow up with them before Checkr's own deadline).
    // report.suspended is Checkr's event for exactly this: the report is
    // paused pending candidate action. report.resumed fires once they've
    // done it — the report then continues on to its normal
    // report.completed outcome, so this just clears the "needs info"
    // state back to in_progress rather than being a final result itself.
    if (type === "report.suspended") {
      await updatePersonStatus(data.candidate_id, "Needs More Info", data.id);
    }
    if (type === "report.resumed") {
      await updatePersonStatus(data.candidate_id, "in_progress");
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
  // Oct 1 (per Checkr's Report Lifecycle certification requirement): a
  // canceled report is just as final/actionable as a failed or expired
  // invitation — same rank, so it can't be downgraded by a late
  // out-of-order transitional event, and can't itself downgrade another
  // final result that already arrived.
  Canceled: 2,
};
function isRegression(currentStatus: string | undefined, newStatus: string): boolean {
  const currentRank = STATUS_RANK[currentStatus || ""] ?? -1;
  const newRank = STATUS_RANK[newStatus] ?? -1;
  return currentRank > newRank;
}

async function updatePersonStatus(
  candidateId: string | undefined,
  status: string,
  reportId?: string,
  includesCanceled?: boolean
) {
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
    const isFinalResult =
      status === "Passed" || status === "Needs Review" || status === "invitation_expired" || status === "Canceled";
    if (isFinalResult && updatedOccupant?.resident_id) {
      const { data: resident } = await supabase
        .from("resident_accounts")
        .select("company_id, full_name")
        .eq("id", updatedOccupant.resident_id)
        .maybeSingle();

      if (resident) {
        const resultLabel =
          status === "Passed"
            ? "passed"
            : status === "Needs Review"
            ? "needs review"
            : status === "Canceled"
            ? "canceled by Checkr (no result — contact Checkr support)"
            : "invitation expired";
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
    .select("checkr_results, company_id, full_name")
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
    r.personKey === personKey
      ? {
          ...r,
          status,
          candidateId,
          ...(reportId ? { reportId } : {}),
          ...(includesCanceled ? { includesCanceled: true } : {}),
        }
      : r
  );
  if (!updated.some((r) => r.personKey === personKey)) {
    updated.push({
      personKey,
      name: personKey,
      candidateId,
      status,
      ...(reportId ? { reportId } : {}),
      ...(includesCanceled ? { includesCanceled: true } : {}),
    });
  }

  const aggregateStatus = computeAggregateStatus(updated);

  await supabase
    .from("resident_applications")
    .update({ checkr_results: updated, background_check_status: aggregateStatus })
    .eq("id", applicationId);

  // Sep 30 (per Mely — found live: Checkr changing a lease application's
  // result to Clear/Consider never notified admin at all, unlike the
  // Household Occupant background check below (which already did this)
  // — an admin had to keep manually reopening the application to see if
  // anything changed). Same resident_update_notifications table/pattern
  // used everywhere else the admin bell watches in real time. Only for a
  // FINAL, actionable result — not the transitional "in_progress" state —
  // and keyed off the per-person status just written, not the aggregate,
  // so each applicant's own result gets its own notification.
  const isFinalResult =
    status === "Passed" || status === "Needs Review" || status === "invitation_expired" || status === "Canceled";
  if (isFinalResult && application.company_id) {
    const resultLabel =
      status === "Passed"
        ? `Clear${includesCanceled ? " (some screenings were canceled — review before approving)" : ""}`
        : status === "Needs Review"
        ? "Consider — needs manual review"
        : status === "Canceled"
        ? "Canceled by Checkr — no result, contact Checkr support"
        : "invitation expired";
    const personLabel =
      personKey === "primary" ? application.full_name : results.find((r) => r.personKey === personKey)?.name || personKey;
    await supabase.from("resident_update_notifications").insert({
      company_id: application.company_id,
      resident_name: application.full_name,
      update_type: "application_background_check_result",
      message: `Background check for ${personLabel} (${application.full_name}'s application): ${resultLabel}.`,
    });
  }

  console.log(
    `Application ${applicationId} — ${personKey} -> ${status} (aggregate: ${aggregateStatus})`
  );
}
