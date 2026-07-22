"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import LeaseApplicationForm, {
  LeaseApplicationData,
  LotOption,
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
  const [initialData, setInitialData] = useState<Partial<LeaseApplicationData> | undefined>(undefined);
  const [invitationLoaded, setInvitationLoaded] = useState(!inviteToken);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  useEffect(() => {
    if (companyLoading) return;
    if (companyError || !company) {
      setLoadError(companyError ?? "Company not found");
      return;
    }

    supabase
      .from("rv_lots_public")
      .select(
        "id, lot_name, base_price, max_length_ft, max_width_ft, amp_service, high_season_price, low_season_price, daily_rate, weekly_rate"
      )
      .eq("company_id", company.id)
      .order("lot_name")
      .then(({ data: lotData, error: lotError }) => {
        if (!lotError) {
          setLots((lotData ?? []).slice().sort(naturalSort));
        }
        setLotsLoaded(true);
      });

    supabase
      .from("park_settings")
      .select("rent_due_day_policy, rent_due_day_fixed, high_season_start_month_day, high_season_end_month_day")
      .eq("company_id", company.id)
      .single()
      .then(({ data: settingsData, error: settingsError }) => {
        if (!settingsError && settingsData) {
          setRentDuePolicy(
            (settingsData.rent_due_day_policy as
              | "fixed"
              | "move_in_anniversary") ?? "fixed"
          );
          setRentDueFixed(settingsData.rent_due_day_fixed ?? 1);
          setHighSeasonStart(settingsData.high_season_start_month_day ?? undefined);
          setHighSeasonEnd(settingsData.high_season_end_month_day ?? undefined);
        }
      });
  }, [company, companyLoading, companyError]);

  useEffect(() => {
    if (!inviteToken) return;

    supabase
      .from("resident_applications")
      .select("*")
      .eq("invite_token", inviteToken)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setInvitationError(
            "This invitation link is invalid or has expired. Please contact the park directly."
          );
          setInvitationLoaded(true);
          return;
        }

        setInvitationId(data.id);
        setInitialData({
          tenant_names: data.full_name ?? data.tenant_names ?? "",
          tenant_email: data.email ?? "",
          tenant_phone: data.phone ?? "",
          space_id: data.space_id ?? "",
          lease_start_date: data.lease_start ?? "",
          rent_amount: data.monthly_rent != null ? String(data.monthly_rent) : "",
          security_deposit_amount:
            data.security_deposit != null ? String(data.security_deposit) : "",
        });
        setInvitationLoaded(true);
      });
  }, [inviteToken]);

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
      const applicationFeeTotal =
        (Number(data.application_fee_primary) || 0) +
        (Number(data.application_fee_per_additional) || 0) * additionalCount;

      const parkSharePrimary = 10.0;
      const parkSharePerAdditional = 5.0;
      const parkShareTotal =
        parkSharePrimary + parkSharePerAdditional * additionalCount;

      const applicationId = invitationId || crypto.randomUUID();

      const row: Record<string, any> = {
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
        rv_vin_or_tag: data.rv_vin_or_tag,

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

        park_share_primary: parkSharePrimary,
        park_share_per_additional: parkSharePerAdditional,
        park_share_total: parkShareTotal,
      };

      let dbError;
      if (invitationId) {
        const { error } = await supabase
          .from("resident_applications")
          .update(row)
          .eq("id", invitationId);
        dbError = error;
      } else {
        const { error } = await supabase
          .from("resident_applications")
          .insert({ id: applicationId, ...row });
        dbError = error;
      }

      if (dbError) {
        throw new Error(dbError.message);
      }

      const res = await fetch(
        "/api/create-application-fee-checkout-session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId }),
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
    }
  }

  if (loadError) {
    return <p style={{ padding: 20, color: "#c00" }}>Error: {loadError}</p>;
  }

  if (invitationError) {
    return <p style={{ padding: 20, color: "#c00" }}>{invitationError}</p>;
  }

  if (!company || !invitationLoaded) {
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
        mode="applicant"
        submitting={submitting}
       company={{
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
