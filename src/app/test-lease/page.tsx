"use client";
import { useEffect, useState } from "react";
import LeaseApplicationForm, {
  LeaseApplicationData,
  LotOption,
} from "@/components/LeaseApplicationForm";
import { supabase } from "@/lib/supabase";

interface Company {
  id: string;
  company_name: string;
  address: string;
  logo_url: string | null;
}

function naturalSort(a: { lot_name: string }, b: { lot_name: string }): number {
  return a.lot_name.localeCompare(b.lot_name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export default function TestLeasePage() {
  const [mode, setMode] = useState<"applicant" | "admin">("applicant");
  const [isMasterAdmin, setIsMasterAdmin] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [lotsLoaded, setLotsLoaded] = useState(false);
  const [rentDuePolicy, setRentDuePolicy] = useState<"fixed" | "move_in_anniversary">("fixed");
  const [rentDueFixed, setRentDueFixed] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("companies")
      .select("id, company_name, address, logo_url")
      .eq("domain", "aloharvparkfl.com")
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadError(error?.message ?? "Company not found");
          return;
        }
        setCompany(data);

        supabase
          .from("rv_lots")
          .select("id, lot_name, base_price, max_length_ft, max_width_ft, amp_service, high_season_price, low_season_price")
          .eq("company_id", data.id)
          .order("lot_name")
          .then(({ data: lotData, error: lotError }) => {
            if (lotError) {
              console.error("Error loading lots:", lotError.message);
            } else {
              setLots((lotData ?? []).slice().sort(naturalSort));
            }
            setLotsLoaded(true);
          });

        supabase
          .from("park_settings")
          .select("rent_due_day_policy, rent_due_day_fixed")
          .eq("company_id", data.id)
          .single()
          .then(({ data: settingsData, error: settingsError }) => {
            if (!settingsError && settingsData) {
              setRentDuePolicy(
                (settingsData.rent_due_day_policy as "fixed" | "move_in_anniversary") ?? "fixed"
              );
              setRentDueFixed(settingsData.rent_due_day_fixed ?? 1);
            }
          });
      });
  }, []);

  async function uploadLicensePhoto(file: File, slotId: string): Promise<string> {
    if (!company) throw new Error("No company loaded");
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${company.id}/test_${Date.now()}/${slotId}.${ext}`;
    const { error } = await supabase.storage
      .from("license-photos")
      .upload(path, file);
    if (error) throw error;
    return path;
  }

  async function handleSubmit(data: LeaseApplicationData) {
    if (!company) return;
    setSubmitting(true);
    setResult(null);
    try {
      const additionalCount = Number(data.application_fee_additional_count) || 0;
      const applicationFeeTotal =
        (Number(data.application_fee_primary) || 0) +
        (Number(data.application_fee_per_additional) || 0) * additionalCount;

      const parkSharePrimary = 10.0;
      const parkSharePerAdditional = 5.0;
      const parkShareTotal =
        parkSharePrimary + parkSharePerAdditional * additionalCount;

      const [firstName, ...rest] = data.tenant_names.split(" ");

      const { error: insertError } = await supabase
        .from("resident_applications")
        .insert({
          company_id: company.id,
          full_name: data.tenant_names,
          space_id: data.space_id || null,
          monthly_rent: Number(data.rent_amount) || 0,
          security_deposit: data.security_deposit_enabled
            ? Number(data.security_deposit_amount) || 0
            : 0,
          lease_start: data.lease_start_date || null,
          status: "Pending",

          filled_by: mode,

          primary_applicant_dob: data.primary_applicant_dob || null,
          primary_applicant_license: data.primary_applicant_license,
          primary_applicant_license_photo_url:
            data.primary_applicant_license_photo_url,

          occupants: data.occupants,
          occupants_enabled: data.occupants_enabled,

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
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      setResult(
        `✅ Guardado en resident_applications. Total a pagar: $${applicationFeeTotal.toFixed(
          2
        )} (tu parte: $${parkShareTotal.toFixed(2)})`
      );
    } catch (err: any) {
      setResult(`❌ Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <p style={{ padding: 20, color: "#c00" }}>Error: {loadError}</p>;
  }

  if (!company) {
    return <p style={{ padding: 20, color: "#777" }}>Loading company...</p>;
  }

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#000",
          color: "#fff",
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Viendo como:</span>
        <button
          onClick={() => setMode("applicant")}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background: mode === "applicant" ? "#fff" : "transparent",
            color: mode === "applicant" ? "#000" : "#fff",
            border: "1px solid #fff",
          }}
        >
          Applicant (residente)
        </button>
        <button
          onClick={() => {
            setMode("admin");
            setIsMasterAdmin(true);
          }}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background:
              mode === "admin" && isMasterAdmin ? "#fff" : "transparent",
            color: mode === "admin" && isMasterAdmin ? "#000" : "#fff",
            border: "1px solid #fff",
          }}
        >
          Admin (tu - master_admin)
        </button>
        <button
          onClick={() => {
            setMode("admin");
            setIsMasterAdmin(false);
          }}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            background:
              mode === "admin" && !isMasterAdmin ? "#fff" : "transparent",
            color: mode === "admin" && !isMasterAdmin ? "#000" : "#fff",
            border: "1px solid #fff",
          }}
        >
          Admin (Yarinette - park_admin)
        </button>
      </div>

      {result && (
        <div
          style={{
            padding: "12px 20px",
            background: result.startsWith("✅") ? "#dcfce7" : "#fee2e2",
            fontSize: 14,
          }}
        >
          {result}
        </div>
      )}

      {lotsLoaded && lots.length === 0 && (
        <div style={{ padding: "10px 20px", background: "#fef3c7", fontSize: 13 }}>
          ⚠️ No se encontraron lotes en `rv_lots` para esta compañía — el
          selector de "Lot" saldrá vacío hasta que tengas lotes cargados ahí.
        </div>
      )}

      <LeaseApplicationForm
        key={`${mode}-${isMasterAdmin}`}
        mode={mode}
        isMasterAdmin={mode === "admin" && isMasterAdmin}
        submitting={submitting}
        company={{
          name: company.company_name,
          address: company.address,
          logoUrl: company.logo_url ?? undefined,
        }}
        availableLots={lots}
        rentDueDayPolicy={rentDuePolicy}
        rentDueDayFixed={rentDueFixed}
        onUploadFile={uploadLicensePhoto}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
