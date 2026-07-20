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

async function updatePersonStatus(candidateId: string | undefined, status: string) {
  if (!candidateId) return;

  const resolved = await resolveCandidate(candidateId);
  if (!resolved) {
    console.log(`Checkr webhook: could not resolve candidate ${candidateId} to an application`);
    return;
  }
  const { applicationId, personKey } = resolved;

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
