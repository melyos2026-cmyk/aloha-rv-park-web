import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { createCheckrInvitation, computeAggregateStatus, CheckrResultEntry } from "@/lib/checkr";

// Aug 24 (per Mely — found live testing "+ New Application"/Mark Fee
// Collected: paying in person never sent the Checkr invitation at all,
// and never calculated what Aloha owes MelyOS for that check either).
// This is the SAME logic stripe-webhook's handleApplicationFeePaid
// already runs after a real Stripe payment, extracted so the manual
// "Mark Fee Collected" path (mark-application-fee-collected/route.ts,
// which lives in the melyos-builder repo) can trigger the exact same
// real background check + cost calculation via this route, instead of
// applicants who pay in cash/in-person never getting invited at all.
function calculateAge(dateOfBirth: string): number | null {
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// Same pricing table as create-application-fee-checkout-session.ts's own
// local copy — deliberately not importing melyos-builder's services/
// checkr.ts (different repo/deployment), kept in sync by hand.
const MELYOS_CHECKR_PRICING: Record<string, number> = {
  basic_plus_criminal: 44.99,
  essential_criminal: 69.99,
  complete_criminal: 99.99,
  rv_park_tenant_screening: 44.99,
};

export async function sendCheckrInvitationsForApplication(applicationId: string): Promise<{
  success: boolean;
  checkrCostTotal: number;
  aggregateStatus?: string;
  error?: string;
}> {
  const { data: application, error: fetchError } = await supabase
    .from("resident_applications")
    .select("id, full_name, email, occupants, company_id, application_fee_additional_count")
    .eq("id", applicationId)
    .maybeSingle();

  if (fetchError || !application) {
    return { success: false, checkrCostTotal: 0, error: fetchError?.message || "Application not found." };
  }

  const people: { personKey: string; name: string; email: string }[] = [];
  if (application.email) {
    people.push({ personKey: "primary", name: application.full_name || "Applicant", email: application.email });
  }
  const occupants = (application.occupants || []) as Array<{ name?: string; date_of_birth?: string; email?: string }>;
  occupants.forEach((occ, i) => {
    if (!occ?.name || !occ?.date_of_birth) return;
    const age = calculateAge(occ.date_of_birth);
    if (age === null || age < 18) return;
    people.push({ personKey: `occupant:${i}`, name: occ.name, email: occ.email || application.email });
  });

  if (people.length === 0) {
    return { success: false, checkrCostTotal: 0, error: "No eligible people to send a background check to." };
  }

  let checkrWorkLocationState = "";
  let checkrPackageSlug = "basic_plus_criminal";
  if (application.company_id) {
    const { data: settings } = await supabase
      .from("park_settings")
      .select("checkr_work_location_state, checkr_default_package_slug")
      .eq("company_id", application.company_id)
      .maybeSingle();
    checkrWorkLocationState = settings?.checkr_work_location_state || "";
    checkrPackageSlug = settings?.checkr_default_package_slug || "basic_plus_criminal";
  }

  if (!checkrWorkLocationState) {
    return {
      success: false,
      checkrCostTotal: 0,
      error: "Checkr Work Location State isn't set in Lease Defaults for this company.",
    };
  }

  const results: CheckrResultEntry[] = [];
  for (const person of people) {
    try {
      const { candidateId } = await createCheckrInvitation({
        applicationId: application.id,
        personKey: person.personKey,
        email: person.email,
        fullName: person.name,
        state: checkrWorkLocationState,
        packageSlug: checkrPackageSlug,
      });
      results.push({ personKey: person.personKey, name: person.name, candidateId, status: "invitation_sent" });
    } catch (checkrErr: any) {
      console.error(`Checkr invitation failed for ${person.name}:`, checkrErr.message);
      results.push({ personKey: person.personKey, name: person.name, status: "invitation_failed" });
    }
  }

  const aggregateStatus = computeAggregateStatus(results);
  const anyInvitationSent = results.some((r) => r.status !== "invitation_failed");

  await supabase
    .from("resident_applications")
    .update({
      checkr_results: results,
      background_check_status: aggregateStatus,
      checkr_package_slug: checkrPackageSlug,
      ...(anyInvitationSent ? { checkr_invitation_sent_at: new Date().toISOString() } : {}),
    })
    .eq("id", applicationId);

  // What MelyOS's real Checkr cost is for this application — used by
  // mark-application-fee-collected to record what the company owes
  // MelyOS for this specific check (there's no Stripe transaction here
  // to deduct it from automatically, so it goes to MelyOS Fees Owed
  // instead, same as the flat $2.50 processing fee already does).
  const costPerCheck = MELYOS_CHECKR_PRICING[checkrPackageSlug] ?? MELYOS_CHECKR_PRICING.basic_plus_criminal;
  const numChecks = 1 + (Number(application.application_fee_additional_count) || 0);
  const checkrCostTotal = anyInvitationSent ? Math.round(costPerCheck * numChecks * 100) / 100 : 0;

  return { success: true, checkrCostTotal, aggregateStatus };
}
