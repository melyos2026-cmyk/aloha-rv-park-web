import { NextRequest, NextResponse } from "next/server";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";
import { createClient } from "@supabase/supabase-js";
import { recordSmsConsentAndConfirm as recordSmsConsent, requestIp } from "@/lib/smsConsent";
import { hostnameFromRequest } from "@/lib/marina/host";
import {
  allowedRentValues,
  computeApplicationFees,
  computeBackgroundCheckRequired,
  countAdditionalAdults,
  leaseDefaultValue,
  matchesAny,
  type LotPricing,
} from "@/lib/applicationPricing";
import { PARK_LEASE_TERM_FIELDS, parkLeaseTerms } from "@/lib/leaseTerms";
import { draftAccessAllowed, draftCookieMatches, newDraftKey, setDraftCookie, storedDraftKeyHash } from "@/lib/applicantGuards";
import { tooManyFromIp, tooManyForKey } from "@/lib/marina/ipLimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Oct 20 (security review): the ONLY columns an applicant's browser may
// write. Everything else on the row (status, payment/Checkr/approval
// fields, archived, invite flags, fee amounts, company) is either set by
// the server below or never touched by this route. This is exactly the
// set of fields /apply/page.tsx builds today — if a NEW applicant field is
// added to that form, add its column here too, or it will be dropped (a
// warning with the dropped keys is logged).
// Oct 26 (security review): the lease's legal terms (late/NSF fees, pet deposit, notice days,
// park rules, additional provisions, RV removal, utilities, payment instructions, parking…) were
// in this list, so an applicant could rewrite their own lease. They are now filled by the server
// from the park's Lease Defaults (see src/lib/leaseTerms.ts) — the filter below removes them.
const APPLICANT_FIELDS = new Set([
  "form_draft_json",
  "full_name",
  "tenant_names",
  "email",
  "phone",
  "space_id",
  "monthly_rent",
  "security_deposit",
  "lease_start",
  "lease_end",
  "primary_applicant_dob",
  "primary_applicant_license",
  "primary_applicant_license_photo_url",
  "occupants",
  "occupants_enabled",
  "current_address",
  "current_city",
  "current_state",
  "current_zip",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "employment_info",
  "housing_company_info",
  "vehicles",
  "vehicles_enabled",
  "notice_days",
  "rent_payment_instructions",
  "late_fee_enabled",
  "late_fee_amount",
  "late_fee_grace_days",
  "nsf_fee_enabled",
  "nsf_fee_amount",
  "rv_make",
  "rv_model",
  "rv_year",
  "rv_length_ft",
  "rv_width_ft",
  "rv_vin_or_tag",
  "slide_out_driver_count",
  "slide_out_passenger_count",
  "rv_description",
  "utilities_included",
  "hazardous_materials_clause",
  "parking_provided",
  "parking_spaces",
  "parking_sticker_name",
  "parking_free",
  "parking_cost",
  "parking_payment_timing",
  "pets_allowed",
  "pets_count",
  "pets_types",
  "golf_carts",
  "golf_cart_driver_ack",
  "pet_details",
  "pet_deposit",
  "pet_restrictions",
  "smoking_policy",
  "smoking_areas",
  "additional_provisions",
  "rv_removal_days",
  "rv_removal_storage_fee",
  "rv_removal_clause",
  "park_rules",
  "park_rules_acknowledged",
  "tenant_signature_name",
  "tenant_signature_agreed",
  "background_check_consent_given",
].filter((k) => !PARK_LEASE_TERM_FIELDS.has(k)));

// Fields the browser still sends but the server now computes itself — not
// worth a warning when they're dropped.
const SERVER_COMPUTED_FIELDS = new Set([
  ...PARK_LEASE_TERM_FIELDS, // Oct 26 (security review): lease terms, filled from Lease Defaults
  "company_id",
  "status",
  "filled_by",
  "tenant_signature_date",
  "background_check_consent_at",
  "application_fee_primary",
  "application_fee_per_additional",
  "application_fee_additional_count",
  "application_fee_total",
  "application_processing_fee",
  "background_check_required",
  "park_share_primary",
  "park_share_per_additional",
  "park_share_total",
]);

// Key inside form_draft_json where the server remembers (a) that this row
// was saved by the checked version of this route and (b) the rent/deposit
// an admin set on the invitation, if any (see "admin-set terms" below).
// Only ever written by the server; anything the browser sends under it is
// replaced.
const SERVER_TERMS_KEY = "_server_terms";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/submit-lease-application
// Body: { applicationId, invitationId, inviteToken, row, ssnRecords }
// Aug 11 (per Mely — RLS hardening pass): resident_applications INSERT/
// UPDATE were open to the anon key with no real restriction. This is the
// one genuinely PUBLIC write in the whole app — a real applicant, with no
// admin session, submitting their own application — so unlike every other
// migration this session, it can't be gated behind an admin-session check.
// Moves the actual write server-side instead; the row-construction logic
// (all the field mapping/validation) stays exactly as it was in
// /apply/page.tsx, only the final insert/update call changed.
//
// Oct 20 (security review — CRITICAL): the browser-built row used to be
// saved exactly as sent, so anyone could mark their own application as
// paid/approved, set background-check results, change the fee amounts,
// file it under another park (company_id), or overwrite ANY application
// by id. Now:
//   - only APPLICANT_FIELDS are taken from the browser;
//   - company_id comes from the website's own domain (new applications) or
//     the existing row (updates) — never from the browser;
//   - status is always "Pending", filled_by "applicant";
//   - background-check requirement and every fee amount are computed here
//     from the park's Lease Defaults + the invitation's own flags, exactly
//     like the form did;
//   - rent and deposit must match what the form itself would show for that
//     lot/dates (or what the admin set on the invitation), within $1;
//   - an existing application can only be updated while it's still unpaid
//     and Invited/Pending, on the same park's website, and a never-yet-
//     submitted invitation also requires the invite link's token.
export async function POST(req: NextRequest) {
  const { applicationId, invitationId, inviteToken, row, ssnRecords } = await req.json();

  // Oct 19 (per Mely): defense in depth — whatever the client sends, an
  // SSN is never written into resident_applications itself.
  if (row && typeof row === "object") {
    delete (row as any).primary_applicant_ssn;
    if (row.form_draft_json && typeof row.form_draft_json === "object") {
      delete row.form_draft_json.primary_applicant_ssn;
      if (Array.isArray(row.form_draft_json.occupants)) {
        row.form_draft_json.occupants = row.form_draft_json.occupants.map((o: any) => {
          const { ssn, ...rest } = o || {};
          return rest;
        });
      }
    }
    if (Array.isArray(row.occupants)) {
      row.occupants = row.occupants.map((o: any) => {
        const { ssn, ...rest } = o || {};
        return rest;
      });
    }
  }

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return NextResponse.json({ error: "row is required." }, { status: 400 });
  }

  // Oct 20 (security review): which park is this? Always the park whose
  // website this request came to (same Host → companies.domain rule every
  // other public route uses).
  const host = hostnameFromRequest(req);
  const { data: hostCompany } = await supabaseAdmin
    .from("companies")
    .select("id, company_name")
    .eq("domain", host)
    .maybeSingle();
  if (!hostCompany?.id) {
    return NextResponse.json(
      { error: "We couldn't identify the park for this website. Please contact the park office." },
      { status: 400 }
    );
  }

  // ---- Existing application (invite link / returning from Stripe) -------
  let existing: any = null;
  if (invitationId) {
    if (typeof invitationId !== "string" || !UUID_RE.test(invitationId)) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }
    const { data } = await supabaseAdmin
      .from("resident_applications")
      .select(
        "id, company_id, status, application_fee_paid, invite_token, sent_at, monthly_rent, security_deposit, " +
          "is_family_friend, is_returning_resident, background_check_override, form_draft_json, created_at"
      )
      .eq("id", invitationId)
      .maybeSingle();
    existing = data;
    if (!existing || existing.company_id !== hostCompany.id) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }
    // Only a still-open application can be changed by the applicant.
    const status = existing.status ?? null;
    if (existing.application_fee_paid === true || !(status === null || status === "Invited" || status === "Pending")) {
      return NextResponse.json(
        {
          error:
            "This application has already been submitted and can no longer be changed online. Please contact the park office.",
        },
        { status: 409 }
      );
    }
    // A never-submitted invitation can only be filled from its invite link.
    // (Once submitted it's "Pending", and the applicant can come back to it
    // from the same browser — e.g. Back from Stripe — by its id, the same
    // way get-application-draft already allows.)
    const tokenMatches =
      typeof inviteToken === "string" &&
      inviteToken.length > 0 &&
      !!existing.invite_token &&
      String(existing.invite_token) === inviteToken;
    if (status === "Invited" && !tokenMatches) {
      return NextResponse.json(
        { error: "This invitation link is invalid or has expired. Please open the link from your invitation again." },
        { status: 403 }
      );
    }
    if (inviteToken && !tokenMatches) {
      return NextResponse.json(
        { error: "This invitation link is invalid or has expired. Please open the link from your invitation again." },
        { status: 403 }
      );
    }
  } else {
    if (!applicationId) {
      return NextResponse.json(
        { error: "applicationId is required for a new application." },
        { status: 400 }
      );
    }
    if (typeof applicationId !== "string" || !UUID_RE.test(applicationId)) {
      return NextResponse.json({ error: "Invalid application id." }, { status: 400 });
    }
  }
  const companyId: string = hostCompany.id;

  // Oct 29 (security review): an already-submitted application can only be saved again from the
  // browser that saved it (its httpOnly draft cookie) or with the invitation link's token — the
  // application id alone is not enough to overwrite someone's application.
  if (existing && !draftAccessAllowed(req, existing, typeof inviteToken === "string" ? inviteToken : null)) {
    return NextResponse.json(
      { error: "For your security, this application can only be changed from the device it was started on, or from your invitation link. Please contact the park office." },
      { status: 403 }
    );
  }

  // Oct 29 (security review): flood limits — per device and per park, counted in the database.
  if (await tooManyFromIp(req, `submit-application:${companyId}`, 20)) {
    return NextResponse.json({ error: "Too many submissions from this device. Please try again later or call the office." }, { status: 429 });
  }
  if (!existing && (await tooManyForKey("submit-application-company", companyId, 60))) {
    return NextResponse.json({ error: "We're receiving a lot of applications right now. Please try again in a little while or call the office." }, { status: 429 });
  }

  // ---- Keep only applicant fields --------------------------------------
  const clean: Record<string, any> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (APPLICANT_FIELDS.has(key)) clean[key] = value;
    else if (!SERVER_COMPUTED_FIELDS.has(key)) dropped.push(key);
  }
  if (dropped.length) {
    console.warn("submit-lease-application: ignored fields from browser:", dropped.join(", "));
  }

  // ---- Park settings + lot --------------------------------------------
  const { data: settings } = await supabaseAdmin
    .from("park_settings")
    .select("lease_defaults, high_season_start_month_day, high_season_end_month_day")
    .eq("company_id", companyId)
    .maybeSingle();
  const leaseDefaults = (settings?.lease_defaults as Record<string, any>) || {};

  let lot: LotPricing | null = null;
  if (clean.space_id) {
    const { data: lotRow } = await supabaseAdmin
      .from("rv_lots")
      .select("id, company_id, base_price, high_season_price, low_season_price, daily_rate, weekly_rate, use_seasonal_pricing")
      .eq("id", clean.space_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!lotRow) {
      return NextResponse.json(
        { error: "The selected lot is not available. Please choose a different lot." },
        { status: 400 }
      );
    }
    lot = lotRow as LotPricing;
  }

  const leaseStart: string | null = clean.lease_start || null;
  const leaseEnd: string | null = clean.lease_end || null;

  // ---- Admin-set terms (invitations) -----------------------------------
  // The rent/deposit an admin put on the invitation. Captured from the
  // invitation row on its FIRST submit and remembered (server-side) inside
  // form_draft_json, because the first submit overwrites those columns.
  const remembered =
    existing?.form_draft_json && typeof existing.form_draft_json === "object"
      ? existing.form_draft_json[SERVER_TERMS_KEY]
      : null;
  const savedBeforeThisCheck = !!existing && !(remembered && typeof remembered === "object");
  let adminTerms: { monthly_rent: number | null; security_deposit: number | null } | null = null;
  if (remembered && typeof remembered === "object" && remembered.invite === true) {
    adminTerms = {
      monthly_rent: remembered.admin_monthly_rent ?? null,
      security_deposit: remembered.admin_security_deposit ?? null,
    };
  } else if (existing && existing.status === "Invited") {
    adminTerms = {
      monthly_rent: existing.monthly_rent ?? null,
      security_deposit: existing.security_deposit ?? null,
    };
  }

  // ---- Rent / deposit must match what the form itself shows ------------
  const sentRent = Number(clean.monthly_rent) || 0;
  const sentDeposit = Number(clean.security_deposit) || 0;
  const leaseDefaultsRent = Number(leaseDefaultValue(leaseDefaults, "rent_amount")) || 0;

  const rentAllowed: number[] =
    adminTerms && adminTerms.monthly_rent != null
      ? [Number(adminTerms.monthly_rent) || 0]
      : allowedRentValues(
          lot,
          leaseStart,
          leaseEnd,
          settings?.high_season_start_month_day,
          settings?.high_season_end_month_day,
          leaseDefaultsRent
        );

  const depositEnabled = !!leaseDefaultValue(leaseDefaults, "security_deposit_enabled");
  const depositSource = adminTerms
    ? Number(adminTerms.security_deposit) || 0 // the invitation's deposit (blank → 0, same as the form)
    : Number(leaseDefaultValue(leaseDefaults, "security_deposit_amount")) || 0;
  const depositAllowed: number[] = [depositEnabled ? depositSource : 0];

  // Applications already in progress before this check existed (e.g. an
  // invited applicant coming back from Stripe right after this deploy) may
  // keep the rent/deposit they were already saved with — remembered so a
  // later resubmit of the same application is accepted too.
  let legacyTerms: { monthly_rent: number | null; security_deposit: number | null } | null = null;
  if (savedBeforeThisCheck && existing.status !== "Invited") {
    legacyTerms = { monthly_rent: existing.monthly_rent ?? null, security_deposit: existing.security_deposit ?? null };
  } else if (remembered && typeof remembered === "object" && remembered.legacy) {
    legacyTerms = {
      monthly_rent: remembered.legacy.monthly_rent ?? null,
      security_deposit: remembered.legacy.security_deposit ?? null,
    };
  }
  if (legacyTerms) {
    if (legacyTerms.monthly_rent != null) rentAllowed.push(Number(legacyTerms.monthly_rent) || 0);
    if (legacyTerms.security_deposit != null) depositAllowed.push(Number(legacyTerms.security_deposit) || 0);
  }

  // Oct 20 (per Mely — never block a real applicant): if the rent/deposit
  // sent by the browser doesn't match what the server calculates, the
  // application is still saved, but with the SERVER's numbers, and the
  // admin gets a System Health note to double-check it before approving.
  // (What is actually charged at checkout is always computed server-side.)
  if (!matchesAny(sentRent, rentAllowed) || !matchesAny(sentDeposit, depositAllowed)) {
    console.warn("submit-lease-application: rent/deposit mismatch", {
      applicationId: invitationId || applicationId,
      sentRent,
      rentAllowed,
      sentDeposit,
      depositAllowed,
    });
    if (!matchesAny(sentRent, rentAllowed) && rentAllowed.length) clean.monthly_rent = rentAllowed[0];
    if (!matchesAny(sentDeposit, depositAllowed) && depositAllowed.length) clean.security_deposit = depositAllowed[0];
    await logSystemHealthIssue({
      companyId,
      issueType: "application_price_check",
      message: `An application for ${clean.full_name || clean.email || "an applicant"} sent rent $${sentRent} / deposit $${sentDeposit}, but the park's prices give rent $${rentAllowed[0] ?? "?"} / deposit $${depositAllowed[0] ?? "?"}. The park's prices were saved — please double-check the rent and deposit before approving.`,
      source: "submit-lease-application",
    });
  }

  // ---- Background check + fees (server-computed) ------------------------
  const backgroundCheckRequired = computeBackgroundCheckRequired({
    leaseStart,
    leaseEnd,
    thresholdDays: Number(leaseDefaultValue(leaseDefaults, "background_check_threshold_days")) || 15,
    isFamilyFriend: !!existing?.is_family_friend,
    isReturningResident: !!existing?.is_returning_resident,
    backgroundCheckOverride: existing?.background_check_override ?? null,
  });
  const fees = computeApplicationFees({
    leaseDefaults,
    backgroundCheckRequired,
    additionalCount: countAdditionalAdults(clean.occupants),
  });

  // ---- Server-owned fields ---------------------------------------------
  const nowIso = new Date().toISOString();
  const formDraft =
    clean.form_draft_json && typeof clean.form_draft_json === "object" && !Array.isArray(clean.form_draft_json)
      ? { ...clean.form_draft_json }
      : {};
  delete formDraft[SERVER_TERMS_KEY];
  // Oct 29: the draft key (and the device that opened checkout) carry over; a row without a key
  // gets one now, sent to this browser as an httpOnly cookie below.
  const previousTerms =
    existing?.form_draft_json && typeof existing.form_draft_json === "object" ? existing.form_draft_json[SERVER_TERMS_KEY] || {} : {};
  // When this save was allowed by the invite token (or the grace period) instead of this
  // browser's cookie, a new key is issued so this browser can come back to it.
  const keptHash = existing && draftCookieMatches(req, existing) ? storedDraftKeyHash(existing.form_draft_json) : null;
  const freshKey = keptHash ? null : newDraftKey();
  formDraft[SERVER_TERMS_KEY] = {
    draft_key: keptHash || freshKey!.hash,
    ...(previousTerms?.hold_device ? { hold_device: previousTerms.hold_device } : {}),
    invite: !!adminTerms,
    ...(adminTerms
      ? { admin_monthly_rent: adminTerms.monthly_rent, admin_security_deposit: adminTerms.security_deposit }
      : {}),
    ...(legacyTerms ? { legacy: legacyTerms } : {}),
  };

  const finalRow: Record<string, any> = {
    ...clean,
    // Oct 26 (security review): lease terms always come from the park's Lease Defaults (the same
    // values the applicant's form displays), never from the browser.
    ...parkLeaseTerms(leaseDefaults),
    form_draft_json: formDraft,
    company_id: companyId,
    status: "Pending",
    filled_by: "applicant",
    tenant_signature_date: clean.tenant_signature_agreed ? nowIso : null,
    background_check_consent_at: clean.background_check_consent_given ? nowIso : null,
    ...fees,
  };

  if (existing) {
    // Sep 29 (per Mely — found live: an archived application got
    // resumed via get-application-draft and carried a real Stripe
    // payment + Checkr invitation through while still archived:true,
    // invisible in the admin Applications tab). get-application-draft
    // now refuses to hand back an archived row in the first place, but
    // this is a second, independent safety net: whatever the client
    // sends, a resumed/updated application is never left archived.
    // Oct 20 (security review): the update is also conditional on the row
    // still being unpaid, so a payment landing at the same moment can't be
    // overwritten.
    const { data: updated, error } = await supabaseAdmin
      .from("resident_applications")
      .update({ ...finalRow, archived: false })
      .eq("id", existing.id)
      .eq("company_id", companyId)
      .eq("application_fee_paid", false)
      .select("id");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "This application has already been submitted and can no longer be changed online. Please contact the park office." },
        { status: 409 }
      );
    }
  } else {
    const { error } = await supabaseAdmin
      .from("resident_applications")
      .insert({ id: applicationId, ...finalRow });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Oct 19 (per Mely — option B): Social Security numbers go ONLY into
  // the private applicant_ssn table (RLS enabled, no policies → only the
  // service role / Supabase dashboard can read it; the admin app never
  // selects from it). Replaced on every resubmit of the same application.
  const savedApplicationId = existing ? existing.id : applicationId;
  if (Array.isArray(ssnRecords) && ssnRecords.length > 0) {
    const cleanSsn = ssnRecords
      .map((r: any) => ({
        company_id: companyId,
        application_id: String(savedApplicationId),
        person_role: r?.person_role === "occupant" ? "occupant" : "primary",
        person_index: Number.isInteger(r?.person_index) ? r.person_index : null,
        full_name: String(r?.full_name || "").trim(),
        ssn: String(r?.ssn || "").replace(/\D/g, ""),
      }))
      .filter((r: any) => r.ssn.length === 9);
    if (cleanSsn.length > 0) {
      await supabaseAdmin.from("applicant_ssn").delete().eq("application_id", String(savedApplicationId));
      const { error: ssnError } = await supabaseAdmin.from("applicant_ssn").insert(cleanSsn);
      if (ssnError) {
        // The application itself is saved; don't block the applicant
        // from paying over this, but make it visible in the logs.
        console.error("applicant_ssn insert failed:", ssnError.message);
      }
    }
  }

  // Oct 19 (per Mely — Twilio A2P 10DLC): the applicant checked the
  // optional "I agree to receive text messages" box → keep proof (exact
  // wording, date, IP). Never blocks the application if it fails.
  if (formDraft.sms_consent === true && finalRow.phone) {
    try {
      await recordSmsConsent({
        companyId,
        phone: String(finalRow.phone),
        name: finalRow.full_name || null,
        source: "application",
        parkName: hostCompany.company_name || "our park",
        ip: requestIp(req),
      });
    } catch (e: any) {
      console.error("sms consent (application) failed:", e?.message);
    }
  }

  const res = NextResponse.json({ success: true });
  if (freshKey) setDraftCookie(res, String(savedApplicationId), freshKey.secret);
  return res;
}
