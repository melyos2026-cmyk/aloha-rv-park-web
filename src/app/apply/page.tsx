"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LeaseApplicationForm, {
  LeaseApplicationData,
  LotOption,
  defaultParkRules,
  calculateProration,
} from "@/components/LeaseApplicationForm";
import { supabase } from "@/lib/supabase";
import { useCompany } from "@/lib/CompanyContext";

function naturalSort(a: { lot_name: string }, b: { lot_name: string }): number {
  return a.lot_name.localeCompare(b.lot_name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function ApplyPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token");

  const { company, loading: companyLoading, error: companyError } = useCompany();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [lotsLoaded, setLotsLoaded] = useState(false);
  const [rentDuePolicy, setRentDuePolicy] = useState<"fixed" | "move_in_anniversary">("fixed");
  const [rentDueFixed, setRentDueFixed] = useState(1);
  const [highSeasonStart, setHighSeasonStart] = useState<string | undefined>(undefined);
  const [highSeasonEnd, setHighSeasonEnd] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [isRentToOwn, setIsRentToOwn] = useState(false);
  // From the admin's invite (see melyos-builder's Send Application modal):
  // background-check skip/require is only ever meaningful for a returning
  // resident; Family/Friends forces an always-skipped, never-charged
  // background check (rent/deposit are unaffected — admin sets those
  // normally, or $0 themselves if that's also the intent). lockAdminFields
  // tells the form the applicant can't edit rent/deposit/lot themselves
  // once the admin set them at invite time — they can only fill in their
  // own personal info.
  const [isReturningResident, setIsReturningResident] = useState(false);
  const [backgroundCheckOverride, setBackgroundCheckOverride] = useState<"" | "required" | "skip">("");
  const [isFamilyFriend, setIsFamilyFriend] = useState(false);
  const [lockAdminFields, setLockAdminFields] = useState(false);
  const [rentToOwnTerms, setRentToOwnTerms] = useState<{
    totalPrice: number | null;
    monthlyPayment: number | null;
    numPayments: number | null;
    deposit: number | null;
    depositPaid: boolean;
  }>({ totalPrice: null, monthlyPayment: null, numPayments: null, deposit: null, depositPaid: false });
  const [initialData, setInitialData] = useState<Partial<LeaseApplicationData> | undefined>(undefined);
  const [invitationLoaded, setInvitationLoaded] = useState(!inviteToken);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  // LeaseApplicationForm only reads `initialData` on its very first render
  // (useState lazy init) — since park_settings/lease_defaults arrives async,
  // the form can mount before it's ready and never pick it up. settingsLoaded
  // gates a one-time remount (via the `key` prop below) once it's actually in.
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Aug 8 (per Mely): polls the same Service Role Key route every 20s
  // while the applicant has this page open, so the "Lot X allows: ..."
  // summary (and the mismatch warnings) reflect a Map Builder edit the
  // admin makes mid-session — a real WebSocket/Supabase Realtime
  // subscription isn't an option here since rv_lots' RLS requires a real
  // admin session, which this public, unauthenticated page never has (it
  // would just go silent, same as a direct anon-key read). A ref (not
  // state) avoids restarting the interval on every keystroke elsewhere
  // in the form.
  const spaceIdRef = useRef("");
  useEffect(() => {
    spaceIdRef.current = initialData?.space_id || "";
  }, [initialData?.space_id]);

  useEffect(() => {
    if (!company) return;
    const interval = setInterval(() => {
      const lockedId = spaceIdRef.current;
      const url = lockedId
        ? `/api/get-available-lots?company_id=${company.id}&locked_lot_id=${lockedId}`
        : `/api/get-available-lots?company_id=${company.id}`;
      fetch(url)
        .then((res) => res.json())
        .then((result) => setLots((result.lots ?? []).slice().sort(naturalSort)))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [company]);

  useEffect(() => {
    if (companyLoading) return;
    if (companyError || !company) {
      setLoadError(companyError ?? "Company not found");
      return;
    }

    fetch(`/api/get-available-lots?company_id=${company.id}`)
      .then((res) => res.json())
      .then((result) => {
        setLots((result.lots ?? []).slice().sort(naturalSort));
        setLotsLoaded(true);
      })
      .catch(() => setLotsLoaded(true));

    supabase
      .from("park_settings")
      .select(
        "rent_due_day_policy, rent_due_day_fixed, high_season_start_month_day, high_season_end_month_day, lease_defaults"
      )
      .eq("company_id", company.id)
      .single()
      .then(
        ({ data: settingsData, error: settingsError }) => {
          if (!settingsError && settingsData) {
            setRentDuePolicy(
              (settingsData.rent_due_day_policy as
                | "fixed"
                | "move_in_anniversary") ?? "fixed"
            );
            setRentDueFixed(settingsData.rent_due_day_fixed ?? 1);
            setHighSeasonStart(settingsData.high_season_start_month_day ?? undefined);
            setHighSeasonEnd(settingsData.high_season_end_month_day ?? undefined);
            // Every applicant — invited or not — starts pre-filled with the
            // park's saved Fees & Deposits / Late Fee / Utilities /
            // Parking-Pets-Smoking / Additional Terms / RV Removal / Park
            // Rules defaults, instead of blank. Safe regardless of which
            // effect resolves first: this spreads defaults first, then prev
            // (whatever the invitation-specific effect already set) on top,
            // so invitation-specific values always win on conflicting keys.
            if (settingsData.lease_defaults) {
              const defaults = { ...settingsData.lease_defaults };
              // An empty/never-customized park_rules shouldn't wipe out the
              // sensible generic defaults (Quiet Hours, Speed Limit, etc.) —
              // only override once the admin has actually saved custom rules.
              if (!defaults.park_rules || defaults.park_rules.length === 0) {
                defaults.park_rules = defaultParkRules;
              }
              setInitialData((prev) => ({
                ...defaults,
                ...prev,
              }));
            }
          }
          setSettingsLoaded(true);
        },
        // Aug 7: the form render is now gated on settingsLoaded (see below),
        // so this MUST flip even if the query rejects outright — otherwise
        // the applicant would sit on "Loading..." forever. Supabase's query
        // builder types its thenable as PromiseLike, which has no .catch()
        // (only the two-argument .then(onFulfilled, onRejected) form) —
        // using .then().catch() here was a TypeScript build error, not
        // just a lint warning, so the whole app failed to deploy.
        () => setSettingsLoaded(true)
      );
  }, [company, companyLoading, companyError, inviteToken]);

  useEffect(() => {
    if (!inviteToken) return;

    fetch(`/api/get-application-invite?token=${encodeURIComponent(inviteToken)}`)
      .then((r) => r.json())
      .then(
        ({ invitation: data, error }) => {
          if (error || !data) {
            setInvitationError(
              "This invitation link is invalid or has expired. Please contact the park directly."
            );
            setInvitationLoaded(true);
            return;
          }

          setInvitationId(data.id);
          setIsRentToOwn(!!data.is_rent_to_own);
          setIsReturningResident(!!data.is_returning_resident);
          setBackgroundCheckOverride(data.background_check_override || "");
          setIsFamilyFriend(!!data.is_family_friend);
          // Lock rent/deposit/lot for the applicant only when the admin
          // actually set them at invite time (a plain invite with no rent
          // entered still lets the applicant see the lot's normal rate) —
          // this is independent of Family/Friends, which only affects
          // background check.
          setLockAdminFields(data.monthly_rent != null);
          setRentToOwnTerms({
            totalPrice: data.rent_to_own_total_price ?? null,
            monthlyPayment: data.rent_to_own_monthly_payment ?? null,
            numPayments: data.rent_to_own_num_payments ?? null,
            deposit: data.rent_to_own_deposit ?? null,
            depositPaid: !!data.rent_to_own_deposit_paid,
          });
          setInitialData((prev) => ({
            ...prev,
            tenant_names: data.full_name ?? data.tenant_names ?? "",
            tenant_email: data.email ?? "",
            tenant_phone: data.phone ?? "",
            space_id: data.space_id ?? "",
            lease_start_date: data.lease_start ?? "",
            // Aug 8 (per Mely): the applicant's lease term (month-to-month
            // vs fixed end date) was never loaded from the invitation row —
            // hasDecidedTerm (which gates Utilities and a few other
            // sections) stayed permanently false for any locked/admin-set
            // invite, since the applicant couldn't set it themselves either
            // (the field is disabled when lockAdminFields is true). Only
            // set these when the admin actually set rent at invite time
            // (data.monthly_rent != null, matching lockAdminFields above)
            // — a plain invite with no rent entered should still let the
            // applicant freely choose their own term as before.
            ...(data.monthly_rent != null
              ? {
                  month_to_month: data.lease_end == null,
                  lease_end_date: data.lease_end ?? "",
                }
              : {}),
            rent_amount: data.monthly_rent != null ? String(data.monthly_rent) : "",
            security_deposit_amount:
              data.security_deposit != null ? String(data.security_deposit) : "",
            // Aug 7 (per Mely): the admin can override electric/laundry per
            // invite. These were saved on the application row but never
            // loaded into the form, so the applicant never saw them. Only
            // override when the admin actually set one — otherwise leave
            // whatever came from the park's Lease Defaults in place.
            ...(data.electric_type ? { electric_type: data.electric_type } : {}),
            ...(data.electric_included_kwh != null
              ? { electric_included_kwh: String(data.electric_included_kwh) }
              : {}),
            ...(data.electric_rate_per_kwh != null
              ? { electric_rate_per_kwh: String(data.electric_rate_per_kwh) }
              : {}),
            ...(data.laundry_type ? { laundry_type: data.laundry_type } : {}),
            ...(data.laundry_monthly_fee != null
              ? { laundry_monthly_fee: String(data.laundry_monthly_fee) }
              : {}),
            // Aug 13 (per Mely): RV/Unit details pre-filled from a
            // connected real-estate listing at invite time, if any — the
            // buyer doesn't know these yet, it's not their RV/home until
            // they buy it.
            ...(data.rv_make ? { rv_make: data.rv_make } : {}),
            ...(data.rv_model ? { rv_model: data.rv_model } : {}),
            ...(data.rv_year != null ? { rv_year: String(data.rv_year) } : {}),
            ...(data.rv_length_ft != null ? { rv_length_ft: String(data.rv_length_ft) } : {}),
            ...(data.rv_width_ft != null ? { rv_width_ft: String(data.rv_width_ft) } : {}),
            ...(data.rv_vin_or_tag ? { rv_vin_or_tag: data.rv_vin_or_tag } : {}),
            ...(data.slide_out_driver_count ? { slide_out_driver_count: data.slide_out_driver_count } : {}),
            ...(data.slide_out_passenger_count ? { slide_out_passenger_count: data.slide_out_passenger_count } : {}),
          }));
          setInvitationLoaded(true);

          // Aug 8 (per Mely): the admin's assigned lot is typically
          // Reserved (no longer "available"), so it can be missing from
          // the lots list fetched above — merge it in explicitly so the
          // locked <select> has a matching <option> instead of falling
          // back to "Select a lot..." with the real value invisible
          // underneath.
          if (data.space_id) {
            fetch(
              `/api/get-available-lots?company_id=${data.company_id}&locked_lot_id=${data.space_id}`
            )
              .then((res) => res.json())
              .then((result) => {
                setLots((result.lots ?? []).slice().sort(naturalSort));
              })
              .catch(() => {});
          }
        },
        // Same PromiseLike/.catch() type issue as the park_settings query
        // above — Supabase's builder has no .catch(), only the
        // two-argument .then(onFulfilled, onRejected) form.
        () => {
          setInvitationError(
            "This invitation link is invalid or has expired. Please contact the park directly."
          );
          setInvitationLoaded(true);
        }
      );
  }, [inviteToken]);

  // Aug 20 (per Mely — "quise volver para atras haber la aplicacion que
  // habia llenado y la aplicacion se me borraron los datos"): recovers an
  // in-progress application if the applicant already submitted once this
  // session (e.g. they clicked through to Stripe, then hit back) instead
  // of showing a blank form. Deliberately skipped when a real invite
  // token is present — that flow already loads its own data above and
  // takes priority. Setting `invitationId` here (same state the invite
  // flow uses) is what makes the eventual re-submit UPDATE this exact
  // row instead of creating a second, duplicate application.
  useEffect(() => {
    if (inviteToken || !company?.id) return;
    const savedId = localStorage.getItem(`melyos_draft_application_${company.id}`);
    if (!savedId) {
      setInvitationLoaded(true);
      return;
    }

    fetch(`/api/get-application-draft?id=${encodeURIComponent(savedId)}`)
      .then((r) => r.json())
      .then(
        ({ application: data, error }) => {
          if (error || !data) {
            // Already paid/approved, or genuinely gone — nothing to
            // recover, so clear the stale pointer and start fresh.
            localStorage.removeItem(`melyos_draft_application_${company.id}`);
            setInvitationLoaded(true);
            return;
          }
          setInvitationId(data.id);
          setInitialData((prev) => ({ ...prev, ...(data.form_draft_json || {}) }));
          setInvitationLoaded(true);
        },
        () => setInvitationLoaded(true)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken, company?.id]);

  async function uploadLicensePhoto(
    file: File,
    slotId: string
  ): Promise<string> {
    if (!company) throw new Error("No company loaded");
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${company.id}/${crypto.randomUUID()}/${slotId}.${ext}`;
    const { error } = await supabase.storage
      .from("license-photos")
      .upload(path, file);
    if (error) throw error;
    return path;
  }

  async function handleSubmit(data: LeaseApplicationData) {
    if (!company) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const additionalCount =
        Number(data.application_fee_additional_count) || 0;

      // Mirrors LeaseApplicationForm's own backgroundCheckRequired logic:
      // month-to-month always requires one; a fixed-term stay only requires
      // one once it's longer than the admin's configured threshold.
      // OVERRIDDEN (Aug 2) when the admin set one at invite time: a Comp
      // Occupant is always skipped (and never charged); a returning
      // resident can be skipped or force-required by the admin. A
      // brand-new resident (not marked returning) can never get an
      // override — always the automatic rule below, no matter what.
      const stayNights =
        !data.month_to_month && data.lease_start_date && data.lease_end_date
          ? Math.round(
              (new Date(data.lease_end_date + "T00:00:00").getTime() -
                new Date(data.lease_start_date + "T00:00:00").getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : null;
      const backgroundCheckThresholdDays =
        Number(data.background_check_threshold_days) || 15;
      const automaticBackgroundCheckRequired =
        data.month_to_month ||
        (stayNights !== null && stayNights > backgroundCheckThresholdDays);
      const backgroundCheckRequired = isFamilyFriend
        ? false
        : isReturningResident && backgroundCheckOverride === "skip"
        ? false
        : isReturningResident && backgroundCheckOverride === "required"
        ? true
        : automaticBackgroundCheckRequired;

      // $2.50 application/processing fee is always charged. The $75
      // primary / $50 per-additional-adult fee is the BACKGROUND CHECK
      // fee — only charged (and only split with the park) when a
      // background check actually applies to this stay.
      const applicationProcessingFee =
        Number(data.application_processing_fee) || 0;
      const backgroundCheckFeeTotal = backgroundCheckRequired
        ? (Number(data.application_fee_primary) || 0) +
          (Number(data.application_fee_per_additional) || 0) * additionalCount
        : 0;
      const applicationFeeTotal =
        applicationProcessingFee + backgroundCheckFeeTotal;

      // Aug 17 (per Mely — "si el background no se paga, este cargo se
      // cobra junto con el primer mes, renta y depósito para que todo sea
      // un pago"): this only ever bundled the stay/rent total for a SHORT
      // stay with a defined end date (stayNights !== null) — a
      // month-to-month lease with background check also skipped (John
      // Smith buying C11's exact scenario) fell through to $0 here,
      // leaving only the $2.50 fee charged today and rent+deposit
      // deferred to the first invoice after approval, contradicting the
      // stated rule. Now bundles first month's rent (data.rent_amount
      // already holds the right figure either way — the full stay total
      // for a short stay, or one month's rent for month-to-month)
      // whenever background check isn't required, regardless of term
      // length. Deposit is billed as its own separate line item, not
      // silently folded into "RV Lot Stay" — see depositAmountForCheckout.
      // Aug 17 (per Mely — "lo que debería cobrar es $354.84 + $200 +
      // $2.50, NO el monthly rent completo"): for a month-to-month lease
      // this must be the PRORATED first-period amount (calculateProration,
      // the same figure shown to the applicant as "First month is
      // prorated: $X for Y of Z days"), not the flat monthly rate — using
      // data.rent_amount directly would have charged the FULL $1000
      // instead of the correct $354.84 for an Aug 21 move-in. For a short
      // stay with a defined end date, data.rent_amount already IS the
      // correct total for that whole stay (not month-based), unchanged.
      const selectedLotForProration = lots.find((l) => l.id === data.space_id);
      const proration = !backgroundCheckRequired && stayNights === null
        ? calculateProration(
            data.lease_start_date,
            Number(data.rent_amount) || 0,
            data.first_month_proration_method || "prorate_monthly",
            selectedLotForProration?.daily_rate ?? null
          )
        : null;
      const stayAmountForCheckout = !backgroundCheckRequired
        ? stayNights !== null
          ? Number(data.rent_amount) || 0
          : proration?.proratedAmount || 0
        : 0;
      const depositAmountForCheckout =
        !backgroundCheckRequired && data.security_deposit_enabled
          ? Number(data.security_deposit_amount) || 0
          : 0;

      // Aug 10 (per Mely): the background check fee Aloha charges its own
      // applicant ($75/$50, now admin-editable — see Lease Defaults) is
      // 100% the park's revenue now — MelyOS no longer takes a cut of
      // this specific Stripe charge. MelyOS's own revenue for the Checkr
      // integration comes from a SEPARATE charge to the park's admin
      // (the Checkr Billing report, billed per background check sent —
      // $44.99/$69.99/$99.99 depending on package), unrelated to what
      // the applicant pays here. Only applicationProcessingFee ($2.50)
      // remains MelyOS's cut of this checkout.
      const parkShareTotal = backgroundCheckFeeTotal;

      const applicationId = invitationId || crypto.randomUUID();

      const row: Record<string, any> = {
        // Aug 20 (per Mely — draft recovery after navigating back from
        // Stripe): the exact form shape, stored verbatim — recovering
        // from this avoids having to hand-map dozens of fields whose
        // column name differs from the form field name (email vs
        // tenant_email, monthly_rent vs rent_amount, etc.), which is
        // fragile and easy to get subtly wrong.
        form_draft_json: data,
        company_id: company.id,
        full_name: data.tenant_names,
        tenant_names: data.tenant_names,
        email: data.tenant_email || null,
        phone: data.tenant_phone || null,
        space_id: data.space_id || null,
        monthly_rent: Number(data.rent_amount) || 0,
        security_deposit: data.security_deposit_enabled
          ? Number(data.security_deposit_amount) || 0
          : 0,
        lease_start: data.lease_start_date || null,
        lease_end: !data.month_to_month && data.lease_end_date ? data.lease_end_date : null,
        status: "Pending",
        filled_by: "applicant",

        primary_applicant_dob: data.primary_applicant_dob || null,
        primary_applicant_license: data.primary_applicant_license,
        primary_applicant_license_photo_url:
          data.primary_applicant_license_photo_url,

        occupants: data.occupants,
        occupants_enabled: data.occupants_enabled,
        vehicles: data.vehicles,
        vehicles_enabled: data.vehicles_enabled,

        notice_days: Number(data.notice_days) || null,
        rent_payment_instructions: data.rent_payment_instructions,

        late_fee_enabled: data.late_fee_enabled,
        late_fee_amount: Number(data.late_fee_amount) || null,
        late_fee_grace_days: Number(data.late_fee_grace_days) || null,

        nsf_fee_enabled: data.nsf_fee_enabled,
        nsf_fee_amount: Number(data.nsf_fee_amount) || null,

        rv_make: data.rv_make,
        rv_model: data.rv_model,
        rv_year: data.rv_year,
        rv_length_ft: Number(data.rv_length_ft) || null,
        rv_width_ft: Number(data.rv_width_ft) || null,
        rv_vin_or_tag: data.rv_vin_or_tag,
        slide_out_driver_count: data.slide_out_driver_count,
        slide_out_passenger_count: data.slide_out_passenger_count,
        rv_description: data.rv_description,

        utilities_included: data.utilities_included,
        hazardous_materials_clause: data.hazardous_materials_clause,

        parking_provided: data.parking_provided,
        parking_spaces: data.parking_spaces,
        parking_sticker_name: data.parking_sticker_name,
        parking_free: data.parking_free,
        parking_cost: Number(data.parking_cost) || null,
        parking_payment_timing: data.parking_payment_timing,

        pets_allowed: data.pets_allowed,
        pets_count: Number(data.pets_count) || null,
        pets_types: data.pets_types,
        pet_deposit: Number(data.pet_deposit) || null,
        pet_restrictions: data.pet_restrictions,

        smoking_policy: data.smoking_policy,
        smoking_areas: data.smoking_areas,

        additional_provisions: data.additional_provisions,

        rv_removal_days: Number(data.rv_removal_days) || null,
        rv_removal_storage_fee: Number(data.rv_removal_storage_fee) || null,
        rv_removal_clause: data.rv_removal_clause,

        park_rules: data.park_rules,
        park_rules_acknowledged: data.park_rules_acknowledged,

        tenant_signature_name: data.tenant_signature_name,
        tenant_signature_agreed: data.tenant_signature_agreed,
        tenant_signature_date: data.tenant_signature_agreed
          ? new Date().toISOString()
          : null,

        background_check_consent_given: data.background_check_consent_given,
        background_check_consent_at: data.background_check_consent_given
          ? new Date().toISOString()
          : null,

        application_fee_primary: Number(data.application_fee_primary) || 0,
        application_fee_per_additional:
          Number(data.application_fee_per_additional) || 0,
        application_fee_additional_count: additionalCount,
        application_fee_total: applicationFeeTotal,
        application_processing_fee: applicationProcessingFee,
        background_check_required: backgroundCheckRequired,

        park_share_primary: backgroundCheckRequired
          ? Number(data.application_fee_primary) || 0
          : 0,
        park_share_per_additional: backgroundCheckRequired
          ? Number(data.application_fee_per_additional) || 0
          : 0,
        park_share_total: parkShareTotal,
      };

      const submitRes = await fetch("/api/submit-lease-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: invitationId ? undefined : applicationId,
          invitationId: invitationId || undefined,
          row,
        }),
      });
      const submitResult = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitResult.error || "Could not save application.");
      }

      // Aug 20 (per Mely): save this application's own id right after a
      // successful save, so if they navigate back from Stripe (or just
      // close the tab and return later) before paying, the effect above
      // recovers everything instead of showing a blank form again.
      if (company?.id) {
        localStorage.setItem(`melyos_draft_application_${company.id}`, invitationId || applicationId);
      }

      const res = await fetch(
        "/api/create-application-fee-checkout-session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applicationId,
            stayAmount: stayAmountForCheckout || undefined,
            depositAmount: depositAmountForCheckout || undefined,
            stayStartDate: data.lease_start_date || undefined,
            stayEndDate: data.lease_end_date || undefined,
            requiresBackgroundCheck: backgroundCheckRequired,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(
          json.error ?? "Application saved, but couldn't start payment."
        );
      }

      window.location.href = json.url;
    } catch (err: any) {
      setErrorMsg(err.message ?? "Something went wrong. Please try again.");
      setSubmitting(false);
      // Aug 17 (per Mely — "despues de OK, Submit no aparecio nada"): the
      // error message was real, it just rendered at the very top of the
      // page while she was scrolled down near the Submit button — same
      // off-screen-message pattern hit repeatedly in the admin app today.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  if (loadError) {
    return <p style={{ padding: 20, color: "#c00" }}>Error: {loadError}</p>;
  }

  if (invitationError) {
    return <p style={{ padding: 20, color: "#c00" }}>{invitationError}</p>;
  }

  if (!company || !invitationLoaded || !settingsLoaded) {
    return <p style={{ padding: 20, color: "#777" }}>Loading...</p>;
  }

  return (
    <div>
      {errorMsg && (
        <div
          style={{
            padding: "12px 20px",
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: 14,
          }}
        >
          ❌ {errorMsg}
        </div>
      )}

      {lotsLoaded && lots.length === 0 && (
        <div
          style={{ padding: "10px 20px", background: "#fef3c7", fontSize: 13 }}
        >
          ⚠️ No lots are available to apply for right now. Please contact the
          park directly.
        </div>
      )}

      <LeaseApplicationForm
        key={settingsLoaded ? "ready" : "loading"}
        mode="applicant"
        submitting={submitting}
       company={{
          id: company.id,
          name: company.company_name,
          address: company.address ?? "",
          logoUrl: company.logo_url ?? undefined,
        }}
        availableLots={lots}
        rentDueDayPolicy={rentDuePolicy}
        rentDueDayFixed={rentDueFixed}
        highSeasonStartMonthDay={highSeasonStart}
        highSeasonEndMonthDay={highSeasonEnd}
        initialData={initialData}
        isRentToOwn={isRentToOwn}
        rentToOwnTerms={rentToOwnTerms}
        applicationId={invitationId}
        lockAdminFields={lockAdminFields}
        isFamilyFriend={isFamilyFriend}
        backgroundCheckOverride={backgroundCheckOverride}
        onUploadFile={uploadLicensePhoto}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default function ApplyPage() {
  return (
    <Suspense fallback={<p style={{ padding: 20, color: "#777" }}>Loading...</p>}>
      <ApplyPageInner />
    </Suspense>
  );
}
