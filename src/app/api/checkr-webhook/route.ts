import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
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
      // Aug 10 (per Mely, from Checkr's own API Guided course): Checkr
      // itself only bills MelyOS once the candidate completes the
      // invitation, not when it's created — an abandoned/expired
      // invitation never costs MelyOS anything. Billing the company at
      // creation time would charge them for checks that might never
      // actually run. Moved the charge here so it only happens once
      // real cost is incurred, matching Checkr's own billing timing.
      await chargeCompanyForCompletedInvitation(data.candidate_id);
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

async function chargeCompanyForCompletedInvitation(candidateId: string | undefined) {
  if (!candidateId) return;

  const resolved = await resolveCandidate(candidateId);
  if (!resolved) {
    console.log(`Checkr webhook: could not resolve candidate ${candidateId} for billing`);
    return;
  }
  const { applicationId, personKey } = resolved;

  let companyId: string | undefined;
  let packageSlug: string | undefined;

  if (applicationId === "occupant") {
    const { data: occupant } = await supabase
      .from("resident_occupants")
      .select("company_id, checkr_package_slug")
      .eq("id", personKey)
      .maybeSingle();
    companyId = occupant?.company_id;
    packageSlug = occupant?.checkr_package_slug;
  } else {
    const { data: application } = await supabase
      .from("resident_applications")
      .select("company_id, checkr_package_slug")
      .eq("id", applicationId)
      .maybeSingle();
    companyId = application?.company_id;
    packageSlug = application?.checkr_package_slug;
  }

  if (!companyId || !packageSlug) {
    console.error(
      `Checkr webhook: missing companyId/packageSlug for candidate ${candidateId} — cannot bill.`
    );
    return;
  }

  try {
    const chargeRes = await fetch(
      "https://admin.aloharvparkfl.com/api/admin/checkr-charge-company",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, packageSlug }),
      }
    );
    const chargeData = await chargeRes.json().catch(() => ({}));
    if (chargeData?.fallback) {
      console.log(
        `MelyOS fronted the Checkr cost for candidate ${candidateId} — company ${companyId} owes it back (checkr_pending_manual_charges).`
      );
    }
  } catch (billingErr: any) {
    console.error("Checkr billing charge request failed:", billingErr.message);
  }
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
        });
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
