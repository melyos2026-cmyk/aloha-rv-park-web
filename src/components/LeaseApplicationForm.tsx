import { useState } from "react";

/**
 * LeaseApplicationForm
 *
 * Reusable across:
 *   - aloha-rv-park-web  -> mode="applicant"  (resident fills it themselves)
 *   - melyos-builder     -> mode="admin"      (Yarinette/Mely fill it on someone's behalf)
 *
 * Uses inline styles throughout (Tailwind v4 production build workaround
 * already established for aloha-rv-park-web).
 *
 * Wire-up: pass an onSubmit that inserts into Supabase `lease_applications`.
 */

type SmokingPolicy = "permitted_areas" | "prohibited";
type ParkingTiming = "upon_execution" | "monthly";

export interface LeaseApplicationData {
  landlord_name: string;
  landlord_address: string;
  tenant_names: string;
  tenant_email: string;
  tenant_phone: string;
  primary_applicant_dob: string;
  primary_applicant_license: string;
  primary_applicant_license_photo_url: string;

  property_address: string;
  space_id: string;

  lease_start_date: string;
  notice_days: string;

  rent_amount: string;
  rent_due_day: string;
  rent_payment_instructions: string;
  use_seasonal_pricing: boolean;

  late_fee_enabled: boolean;
  late_fee_amount: string;
  late_fee_grace_days: string;

  security_deposit_enabled: boolean;
  security_deposit_amount: string;
  security_deposit_return_days: string;

  nsf_fee_enabled: boolean;
  nsf_fee_amount: string;

  occupants_enabled: boolean;
  occupants: OccupantInfo[]; // up to 5 slots

  vehicles_enabled: boolean;
  vehicles: VehicleInfo[]; // up to 3 slots

  rv_make: string;
  rv_model: string;
  rv_year: string;
  rv_length_ft: string;
  rv_vin_or_tag: string;

  utilities_included: string;

  hazardous_materials_clause: string;

  parking_provided: boolean;
  parking_spaces: string;
  parking_free: boolean;
  parking_cost: string;
  parking_payment_timing: ParkingTiming;
  parking_sticker_name: string;

  pets_allowed: boolean;
  pets_count: string;
  pets_types: string;
  pet_deposit: string;
  pet_restrictions: string;

  smoking_policy: SmokingPolicy;
  smoking_areas: string;

  additional_provisions: string;

  rv_removal_days: string;
  rv_removal_storage_fee: string;
  rv_removal_clause: string;

  park_rules: ParkRule[];
  park_rules_acknowledged: boolean;

  tenant_signature_name: string;
  tenant_signature_agreed: boolean;

  application_fee_primary: string;
  application_fee_per_additional: string;
  application_fee_additional_count: string;
  background_check_consent_given: boolean;
}

export interface ParkRule {
  id: string;
  title: string;
  text: string;
}

export interface OccupantInfo {
  name: string;
  date_of_birth: string; // yyyy-mm-dd
  license_number: string;
  license_photo_url: string;
  email?: string; // optional — falls back to the primary applicant's email for Checkr invitations
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

interface ProrationResult {
  proratedAmount: number;
  daysUsed: number;
  daysInMonth: number;
  periodEndLabel: string;
  isFullMonth: boolean;
}

function calculateProration(
  leaseStartDate: string,
  monthlyRent: number
): ProrationResult | null {
  if (!leaseStartDate || monthlyRent <= 0) return null;
  const start = new Date(leaseStartDate + "T00:00:00");
  if (isNaN(start.getTime())) return null;

  const year = start.getFullYear();
  const month = start.getMonth();
  const dayOfMonth = start.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (dayOfMonth === 1) {
    return {
      proratedAmount: monthlyRent,
      daysUsed: daysInMonth,
      daysInMonth,
      periodEndLabel: "",
      isFullMonth: true,
    };
  }

  const daysUsed = daysInMonth - dayOfMonth + 1;
  const proratedAmount = Math.round((monthlyRent / daysInMonth) * daysUsed * 100) / 100;
  const endOfMonth = new Date(year, month, daysInMonth);
  const periodEndLabel = endOfMonth.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return { proratedAmount, daysUsed, daysInMonth, periodEndLabel, isFullMonth: false };
}

function isDateInSeason(
  dateStr: string,
  startMonthDay: string,
  endMonthDay: string
): boolean {
  const [, m, d] = dateStr.split("-").map(Number); // dateStr is yyyy-mm-dd
  const [startM, startD] = startMonthDay.split("-").map(Number);
  const [endM, endD] = endMonthDay.split("-").map(Number);

  const toComparable = (mm: number, dd: number) => mm * 100 + dd;
  const target = toComparable(m, d);
  const start = toComparable(startM, startD);
  const end = toComparable(endM, endD);

  if (start <= end) {
    return target >= start && target <= end;
  }
  // wraps across year-end, e.g. Oct 1 - Apr 30
  return target >= start || target <= end;
}

function getSeasonalRent(
  lot: LotOption,
  leaseStartDate: string,
  highSeasonStartMonthDay?: string,
  highSeasonEndMonthDay?: string
): number | null {
  if (
    !highSeasonStartMonthDay ||
    !highSeasonEndMonthDay ||
    !leaseStartDate ||
    lot.high_season_price == null ||
    lot.low_season_price == null
  ) {
    return null;
  }
  const inHighSeason = isDateInSeason(
    leaseStartDate,
    highSeasonStartMonthDay,
    highSeasonEndMonthDay
  );
  return inHighSeason ? lot.high_season_price : lot.low_season_price;
}

const emptyOccupants: OccupantInfo[] = [
  { name: "", date_of_birth: "", license_number: "", license_photo_url: "", email: "" },
  { name: "", date_of_birth: "", license_number: "", license_photo_url: "", email: "" },
  { name: "", date_of_birth: "", license_number: "", license_photo_url: "", email: "" },
  { name: "", date_of_birth: "", license_number: "", license_photo_url: "", email: "" },
  { name: "", date_of_birth: "", license_number: "", license_photo_url: "", email: "" },
];

interface VehicleInfo {
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
  color: string;
  license_plate: string;
  license_state: string;
}

const emptyVehicles: VehicleInfo[] = [
  { vehicle_make: "", vehicle_model: "", vehicle_year: "", color: "", license_plate: "", license_state: "" },
  { vehicle_make: "", vehicle_model: "", vehicle_year: "", color: "", license_plate: "", license_state: "" },
  { vehicle_make: "", vehicle_model: "", vehicle_year: "", color: "", license_plate: "", license_state: "" },
];

const defaultParkRules: ParkRule[] = [
  {
    id: "quiet_hours",
    title: "Quiet Hours",
    text: "Quiet hours are from 9:00 PM to 7:00 AM daily.",
  },
  {
    id: "speed_limit",
    title: "Speed Limit",
    text: "Speed limit throughout the park is 5 mph at all times.",
  },
  {
    id: "lot_appearance",
    title: "Lot & RV Appearance",
    text: "Tenant must keep the lot and the RV in clean, orderly condition at all times.",
  },
  {
    id: "laundry",
    title: "Laundry Facilities",
    text: "Laundry facilities are open 24/7. Each tenant pays for their own use. Laundry left unattended in a washer or dryer for more than 5 minutes after the cycle ends may be removed by the next tenant who needs the machine.",
  },
  {
    id: "restrooms",
    title: "Restrooms & Showers",
    text: "Restrooms and showers are separated by gender (men's and women's). Under no circumstance may these facilities be shared between genders.",
  },
];

const emptyForm: LeaseApplicationData = {
  landlord_name: "",
  landlord_address: "",
  tenant_names: "",
  tenant_email: "",
  tenant_phone: "",
  primary_applicant_dob: "",
  primary_applicant_license: "",
  primary_applicant_license_photo_url: "",
  property_address: "",
  space_id: "",
  lease_start_date: "",
  notice_days: "15",
  rent_amount: "",
  rent_due_day: "1",
  rent_payment_instructions: "",
  use_seasonal_pricing: true,
  late_fee_enabled: false,
  late_fee_amount: "",
  late_fee_grace_days: "",
  security_deposit_enabled: false,
  security_deposit_amount: "",
  security_deposit_return_days: "15",
  nsf_fee_enabled: false,
  nsf_fee_amount: "",
  occupants_enabled: false,
  occupants: emptyOccupants,
  vehicles_enabled: false,
  vehicles: emptyVehicles,
  rv_make: "",
  rv_model: "",
  rv_year: "",
  rv_length_ft: "",
  rv_vin_or_tag: "",
  utilities_included: "",
  hazardous_materials_clause:
    "Tenant may keep and use propane, gasoline, or other fuel that is factory-installed or normally used to operate the RV and its appliances (e.g., propane tanks connected to the RV's own system). Tenant agrees not to store any additional loose or spare fuel containers, gas cylinders, gasoline, kerosene, fireworks, or other flammable or explosive materials on the lot beyond what is necessary for the ordinary operation of the RV.",
  parking_provided: false,
  parking_spaces: "1",
  parking_free: true,
  parking_cost: "",
  parking_payment_timing: "monthly",
  parking_sticker_name: "",
  pets_allowed: false,
  pets_count: "",
  pets_types: "",
  pet_deposit: "",
  pet_restrictions: "No aggressive or restricted breeds (e.g. Pit Bulls).",
  smoking_policy: "prohibited",
  smoking_areas: "",
  additional_provisions: "",
  rv_removal_days: "7",
  rv_removal_storage_fee: "25.00",
  rv_removal_clause:
    "Upon termination of this Agreement, Tenant shall remove the RV and all personal property from the lot within the number of days stated above. If the RV and/or personal property is not removed within that period, Park may treat the RV as abandoned, may charge a daily storage fee as stated above until removal, and/or may remove, store, and dispose of the RV and any remaining personal property in accordance with Florida law, at Tenant's sole expense. Park shall not be liable for any damage to the RV or personal property in connection with such removal or storage.",
  park_rules: defaultParkRules,
  park_rules_acknowledged: false,
  tenant_signature_name: "",
  tenant_signature_agreed: false,
  application_fee_primary: "75.00",
  application_fee_per_additional: "50.00",
  application_fee_additional_count: "0",
  background_check_consent_given: false,
};

export interface CompanyInfo {
  name: string;
  address: string;
  logoUrl?: string;
}

export interface LotOption {
  id: string;
  lot_name: string;
  base_price: number | null;
  max_length_ft: number | null;
  max_width_ft: number | null;
  amp_service: string | null;
  high_season_price: number | null;
  low_season_price: number | null;
}

interface Props {
  mode: "applicant" | "admin";
  isMasterAdmin?: boolean; // true only for Mely (MelyOS) - controls platform-owned fees like the application/background check fee
  company: CompanyInfo;
  availableLots?: LotOption[]; // if provided, shows a real lot dropdown instead of free text
  rentDueDayPolicy?: "fixed" | "move_in_anniversary"; // from park_settings
  rentDueDayFixed?: number; // used when policy is 'fixed'
  highSeasonStartMonthDay?: string; // e.g. '10-01', from park_settings
  highSeasonEndMonthDay?: string; // e.g. '04-30', wraps across year-end if end < start
  initialData?: Partial<LeaseApplicationData>;
  onSubmit: (data: LeaseApplicationData) => Promise<void> | void;
  onUploadFile?: (file: File, slotId: string) => Promise<string>; // uploads to Supabase Storage, returns the storage path
  submitting?: boolean;
}

const styles = {
  page: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "32px 20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#111",
  },
  card: {
    background: "#fff",
    border: "1px solid #e5e5e5",
    borderRadius: 10,
    padding: "24px 24px 8px",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 16,
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
  },
  row: {
    display: "flex",
    gap: 12,
    marginBottom: 16,
    flexWrap: "wrap" as const,
  },
  field: {
    flex: "1 1 220px",
    display: "flex",
    flexDirection: "column" as const,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    color: "#444",
  },
  input: {
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #ccc",
    fontSize: 14,
  },
  textarea: {
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #ccc",
    fontSize: 14,
    minHeight: 70,
    fontFamily: "inherit",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    fontSize: 14,
  },
  submitBtn: {
    background: "#000",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "14px 24px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  helper: {
    fontSize: 12,
    color: "#777",
    marginBottom: 20,
  },
  requiredNote: {
    fontSize: 12,
    color: "#c00",
    marginTop: 4,
    fontWeight: 500,
  },
};

export default function LeaseApplicationForm({
  mode,
  isMasterAdmin,
  company,
  availableLots,
  rentDueDayPolicy = "fixed",
  rentDueDayFixed = 1,
  highSeasonStartMonthDay,
  highSeasonEndMonthDay,
  initialData,
  onSubmit,
  onUploadFile,
  submitting,
}: Props) {
  const [data, setData] = useState<LeaseApplicationData>({
    ...emptyForm,
    landlord_name: company.name,
    landlord_address: company.address,
    ...initialData,
  });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  async function handlePhotoUpload(
    file: File,
    slotId: string,
    onDone: (url: string) => void
  ) {
    if (!onUploadFile) return;
    setUploadingSlot(slotId);
    try {
      const url = await onUploadFile(file, slotId);
      onDone(url);
    } catch (e) {
      alert("Couldn't upload photo. Please try again.");
    } finally {
      setUploadingSlot(null);
    }
  }

  const set = <K extends keyof LeaseApplicationData>(
    key: K,
    value: LeaseApplicationData[K]
  ) => setData((prev) => ({ ...prev, [key]: value }));

  const additionalAdultsCount = data.occupants.filter((occ) => {
    const age = calculateAge(occ.date_of_birth);
    return occ.name.trim() !== "" && age !== null && age >= 18;
  }).length;

  const selectedLot = availableLots?.find((l) => l.id === data.space_id);
  const rvLengthNum = Number(data.rv_length_ft) || 0;
  const rvTooLong =
    !!selectedLot?.max_length_ft &&
    rvLengthNum > 0 &&
    rvLengthNum > selectedLot.max_length_ft;

  const primaryApplicantAge = calculateAge(data.primary_applicant_dob);
  const primaryApplicantUnderage =
    primaryApplicantAge !== null && primaryApplicantAge < 18;

  const adultOccupantsMissingLicense = data.occupants.some((occ) => {
    const age = calculateAge(occ.date_of_birth);
    const isAdult = occ.name.trim() !== "" && age !== null && age >= 18;
    return isAdult && (!occ.license_number || !occ.license_photo_url);
  });

  const proration = calculateProration(
    data.lease_start_date,
    Number(data.rent_amount) || 0
  );

  const currentSeasonLabel =
    data.use_seasonal_pricing &&
    selectedLot &&
    data.lease_start_date &&
    highSeasonStartMonthDay &&
    highSeasonEndMonthDay &&
    selectedLot.high_season_price != null &&
    selectedLot.low_season_price != null
      ? isDateInSeason(
          data.lease_start_date,
          highSeasonStartMonthDay,
          highSeasonEndMonthDay
        )
        ? "High Season"
        : "Low Season"
      : null;

  const computedRentDueDay =
    rentDueDayPolicy === "fixed"
      ? rentDueDayFixed
      : data.lease_start_date
      ? new Date(data.lease_start_date + "T00:00:00").getDate()
      : null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.tenant_email);

  const canSubmit =
    mode === "admin"
      ? true
      : data.landlord_name &&
        data.tenant_names &&
        data.tenant_email &&
        emailValid &&
        data.property_address &&
        data.rent_amount &&
        data.primary_applicant_dob &&
        data.primary_applicant_license &&
        data.primary_applicant_license_photo_url &&
        !primaryApplicantUnderage &&
        !adultOccupantsMissingLicense &&
        data.tenant_signature_name &&
        data.tenant_signature_agreed &&
        data.park_rules_acknowledged &&
        data.background_check_consent_given &&
        !rvTooLong;

  return (
    <div style={styles.page}>
      <div
        style={{
          marginBottom: 20,
          paddingBottom: 20,
          borderBottom: "1px solid #eee",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700 }}>{company.name}</div>
        <div style={{ fontSize: 13, color: "#666" }}>{company.address}</div>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Lease Application
      </h1>
      <p style={styles.helper}>
        {mode === "applicant"
          ? "Fill out this application to apply for your lot. You'll be able to review everything before signing."
          : "Fill out this application on behalf of the resident. They'll receive a copy to confirm."}
      </p>

      {/* 1-2. Parties & Property */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Parties &amp; Property</div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Tenant Name(s)</label>
            <input
              style={styles.input}
              placeholder="e.g. John Smith, Mary Smith"
              value={data.tenant_names}
              onChange={(e) => set("tenant_names", e.target.value)}
            />
            {mode === "applicant" && attemptedSubmit && !data.tenant_names && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Lot</label>
            {availableLots ? (
              <select
                style={styles.input}
                value={data.space_id}
                onChange={(e) => {
                  const lot = availableLots.find(
                    (l) => l.id === e.target.value
                  );
                  set("space_id", e.target.value);
                  if (lot) {
                    set("property_address", lot.lot_name);
                    if (data.use_seasonal_pricing) {
                      const seasonal = getSeasonalRent(
                        lot,
                        data.lease_start_date,
                        highSeasonStartMonthDay,
                        highSeasonEndMonthDay
                      );
                      set(
                        "rent_amount",
                        String(seasonal ?? lot.base_price ?? "")
                      );
                    } else {
                      set("rent_amount", String(lot.base_price ?? ""));
                    }
                  }
                }}
              >
                <option value="">Select a lot...</option>
                {availableLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lot_name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                style={styles.input}
                value={data.property_address}
                onChange={(e) => set("property_address", e.target.value)}
              />
            )}
            {mode === "applicant" && attemptedSubmit && !data.property_address && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Email Address</label>
            <input
              type="email"
              style={{
                ...styles.input,
                borderColor:
                  attemptedSubmit && mode === "applicant" && (!data.tenant_email || !emailValid)
                    ? "#c00"
                    : "#ccc",
              }}
              placeholder="you@example.com"
              value={data.tenant_email}
              onChange={(e) => set("tenant_email", e.target.value)}
            />
            {mode === "applicant" && attemptedSubmit && !data.tenant_email && (
              <div style={styles.requiredNote}>Field required</div>
            )}
            {mode === "applicant" &&
              attemptedSubmit &&
              data.tenant_email &&
              !emailValid && (
                <div style={styles.requiredNote}>Enter a valid email address</div>
              )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>
              Phone Number{" "}
              <span style={{ fontWeight: 400, color: "#999" }}>(optional)</span>
            </label>
            <input
              type="tel"
              style={styles.input}
              placeholder="(555) 555-5555"
              value={data.tenant_phone}
              onChange={(e) => set("tenant_phone", e.target.value)}
            />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Primary Applicant Date of Birth</label>
            <input
              type="date"
              style={{
                ...styles.input,
                borderColor: primaryApplicantUnderage ? "#c00" : "#ccc",
              }}
              value={data.primary_applicant_dob}
              onChange={(e) => set("primary_applicant_dob", e.target.value)}
            />
            {primaryApplicantUnderage && (
              <div style={{ fontSize: 12, color: "#c00", marginTop: 4 }}>
                You must be 18 or older to apply.
              </div>
            )}
            {mode === "applicant" && attemptedSubmit && !data.primary_applicant_dob && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Primary Applicant Driver's License #</label>
            <input
              style={styles.input}
              value={data.primary_applicant_license}
              onChange={(e) =>
                set("primary_applicant_license", e.target.value)
              }
            />
            {mode === "applicant" && attemptedSubmit && !data.primary_applicant_license && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Photo of License</label>
            {data.primary_applicant_license_photo_url ? (
              <div style={{ fontSize: 13, color: "#166534" }}>
                ✓ Photo uploaded{" "}
                <button
                  type="button"
                  onClick={() => set("primary_applicant_license_photo_url", "")}
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    color: "#c00",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={styles.input}
                disabled={uploadingSlot === "primary"}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handlePhotoUpload(file, "primary", (url) =>
                      set("primary_applicant_license_photo_url", url)
                    );
                  }
                }}
              />
            )}
            {uploadingSlot === "primary" && (
              <span style={{ fontSize: 12, color: "#777" }}>Uploading...</span>
            )}
            {mode === "applicant" && attemptedSubmit && !data.primary_applicant_license_photo_url && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
        </div>
      </div>

      {/* 3-4. Lease Term & Rent */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Lease Term &amp; Rent</div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Lease Start Date</label>
            <input
              type="date"
              style={styles.input}
              value={data.lease_start_date}
              min={new Date().toISOString().split("T")[0]}
              onChange={(e) => {
                const newDate = e.target.value;
                set("lease_start_date", newDate);
                if (selectedLot && data.use_seasonal_pricing) {
                  const seasonal = getSeasonalRent(
                    selectedLot,
                    newDate,
                    highSeasonStartMonthDay,
                    highSeasonEndMonthDay
                  );
                  if (seasonal !== null) {
                    set("rent_amount", String(seasonal));
                  }
                }
              }}
            />
            {mode === "applicant" && attemptedSubmit && !data.lease_start_date && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
        </div>

        {mode === "admin" ? (
          <>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.use_seasonal_pricing}
                onChange={(e) =>
                  set("use_seasonal_pricing", e.target.checked)
                }
              />
              Use seasonal pricing (uncheck for legacy/grandfathered
              residents with a fixed rate)
            </label>
            <div style={styles.row}>
              <div style={styles.field}>
                <label style={styles.label}>Notice Period (days)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={data.notice_days}
                  onChange={(e) => set("notice_days", e.target.value)}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>
                  Monthly Rent ($){" "}
                  {currentSeasonLabel && (
                    <span style={{ fontWeight: 400, color: "#999" }}>
                      ({currentSeasonLabel})
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  style={styles.input}
                  value={data.rent_amount}
                  onChange={(e) => set("rent_amount", e.target.value)}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>
                  Rent Due Day{" "}
                  <span style={{ fontWeight: 400, color: "#999" }}>
                    (suggested: {computedRentDueDay ?? "—"}, based on{" "}
                    {rentDueDayPolicy === "fixed"
                      ? "park policy"
                      : "move-in date"}
                    )
                  </span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  style={styles.input}
                  value={data.rent_due_day || String(computedRentDueDay ?? "")}
                  onChange={(e) => set("rent_due_day", e.target.value)}
                />
              </div>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Payment Instructions</label>
              <textarea
                style={styles.textarea}
                value={data.rent_payment_instructions}
                onChange={(e) =>
                  set("rent_payment_instructions", e.target.value)
                }
              />
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6 }}>
            <div>
              <strong>Monthly Rent:</strong> ${data.rent_amount || "TBD"}
              {currentSeasonLabel && ` (${currentSeasonLabel})`}
            </div>
            <div>
              <strong>Due Day:</strong> {computedRentDueDay ?? "TBD"} of each
              month
            </div>
            <div>
              <strong>Notice Period:</strong> {data.notice_days || "TBD"} days
            </div>
            {data.rent_payment_instructions && (
              <div>
                <strong>Payment Instructions:</strong>{" "}
                {data.rent_payment_instructions}
              </div>
            )}
          </div>
        )}

        {proration && (
          <div
            style={{
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderRadius: 8,
              padding: "12px 14px",
              marginTop: 12,
              fontSize: 13,
              color: "#075985",
            }}
          >
            {proration.isFullMonth ? (
              <div>
                Since the lease starts on the 1st, the first month's rent is
                the full ${proration.proratedAmount.toFixed(2)}.
              </div>
            ) : (
              <div>
                <strong>First month is prorated:</strong> $
                {proration.proratedAmount.toFixed(2)} for {proration.daysUsed}{" "}
                of {proration.daysInMonth} days (through {proration.periodEndLabel}
                ). Full rent of ${(Number(data.rent_amount) || 0).toFixed(2)}
                /month starts the following month.
              </div>
            )}
          </div>
        )}

        <div
          style={{
            fontSize: 12,
            color: "#999",
            marginTop: 10,
          }}
        >
          Note: Rent is not charged today. Only the application fee below is
          due now. Rent begins once your application is approved.
        </div>
      </div>

      {/* 5-7. Fees & Deposits */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Fees &amp; Deposits</div>

        {mode === "admin" ? (
          <>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.late_fee_enabled}
                onChange={(e) => set("late_fee_enabled", e.target.checked)}
              />
              Charge a late fee
            </label>
            {data.late_fee_enabled && (
              <div style={styles.row}>
                <div style={styles.field}>
                  <label style={styles.label}>Late Fee Amount ($)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={data.late_fee_amount}
                    onChange={(e) => set("late_fee_amount", e.target.value)}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Grace Period (days)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={data.late_fee_grace_days}
                    onChange={(e) =>
                      set("late_fee_grace_days", e.target.value)
                    }
                  />
                </div>
              </div>
            )}

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.security_deposit_enabled}
                onChange={(e) =>
                  set("security_deposit_enabled", e.target.checked)
                }
              />
              Require a security deposit
            </label>
            {data.security_deposit_enabled && (
              <div style={styles.row}>
                <div style={styles.field}>
                  <label style={styles.label}>Deposit Amount ($)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={data.security_deposit_amount}
                    onChange={(e) =>
                      set("security_deposit_amount", e.target.value)
                    }
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Return Within (days)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={data.security_deposit_return_days}
                    onChange={(e) =>
                      set("security_deposit_return_days", e.target.value)
                    }
                  />
                </div>
              </div>
            )}

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.nsf_fee_enabled}
                onChange={(e) => set("nsf_fee_enabled", e.target.checked)}
              />
              Charge a fee for returned/bounced checks
            </label>
            {data.nsf_fee_enabled && (
              <div style={styles.field}>
                <label style={styles.label}>NSF Fee Amount ($)</label>
                <input
                  type="number"
                  style={styles.input}
                  value={data.nsf_fee_amount}
                  onChange={(e) => set("nsf_fee_amount", e.target.value)}
                />
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6 }}>
            <div>
              <strong>Late Fee:</strong>{" "}
              {data.late_fee_enabled
                ? `$${data.late_fee_amount} if rent is more than ${data.late_fee_grace_days} day(s) late.`
                : "None."}
            </div>
            <div>
              <strong>Security Deposit:</strong>{" "}
              {data.security_deposit_enabled
                ? `$${data.security_deposit_amount}, returned within ${data.security_deposit_return_days} days after lease ends.`
                : "None required."}
            </div>
            <div>
              <strong>Returned Check Fee:</strong>{" "}
              {data.nsf_fee_enabled
                ? `$${data.nsf_fee_amount} per incident.`
                : "None."}
            </div>
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 16 }}>
          Hazardous Materials
        </div>
        {mode === "admin" ? (
          <textarea
            style={{ ...styles.textarea, minHeight: 130, width: "100%", boxSizing: "border-box" }}
            value={data.hazardous_materials_clause}
            onChange={(e) =>
              set("hazardous_materials_clause", e.target.value)
            }
          />
        ) : (
          <div style={{ fontSize: 13, color: "#333" }}>
            {data.hazardous_materials_clause}
          </div>
        )}
      </div>

      {/* 8-10. Occupants, Furnishings, Utilities */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Occupants, RV Info &amp; Utilities</div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          Everyone Living on the Lot
        </div>

        {/* Primary applicant - auto-filled from Tenant Name(s) above, not re-entered */}
        <div
          style={{
            border: "1px solid #ddd",
            background: "#fafafa",
            borderRadius: 8,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#666", marginBottom: 6 }}>
            PRIMARY APPLICANT (from Tenant Name(s) above)
          </div>
          <div style={{ fontSize: 14 }}>
            {data.tenant_names || "—"}
            {(() => {
              const age = calculateAge(data.primary_applicant_dob);
              return age !== null ? ` · Age ${age}` : "";
            })()}
            {data.primary_applicant_license
              ? ` · License ${data.primary_applicant_license}`
              : ""}
          </div>
        </div>

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={data.occupants_enabled}
            onChange={(e) => set("occupants_enabled", e.target.checked)}
          />
          Additional people besides the primary applicant
        </label>
        {data.occupants_enabled && (
          <div>
            {[0, 1, 2, 3, 4].map((i) => {
              const occ = data.occupants[i] ?? {
                name: "",
                date_of_birth: "",
                license_number: "",
                license_photo_url: "",
              };
              const age = calculateAge(occ.date_of_birth);
              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={styles.row}>
                    <div style={styles.field}>
                      <label style={styles.label}>
                        Occupant {i + 1} Name
                      </label>
                      <input
                        style={styles.input}
                        value={occ.name}
                        onChange={(e) => {
                          const updated = [...data.occupants];
                          updated[i] = { ...occ, name: e.target.value };
                          set("occupants", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Date of Birth</label>
                      <input
                        type="date"
                        style={styles.input}
                        value={occ.date_of_birth}
                        onChange={(e) => {
                          const updated = [...data.occupants];
                          updated[i] = {
                            ...occ,
                            date_of_birth: e.target.value,
                          };
                          set("occupants", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Driver's License #{" "}
                        {age !== null && age >= 18 ? "(required)" : ""}
                      </label>
                      <input
                        style={styles.input}
                        value={occ.license_number}
                        onChange={(e) => {
                          const updated = [...data.occupants];
                          updated[i] = {
                            ...occ,
                            license_number: e.target.value,
                          };
                          set("occupants", updated);
                        }}
                      />
                    </div>
                    {age !== null && age >= 18 && (
                      <div style={styles.field}>
                        <label style={styles.label}>
                          Email (optional — for their own background check invite)
                        </label>
                        <input
                          type="email"
                          style={styles.input}
                          value={occ.email || ""}
                          placeholder="Leave blank to use the primary applicant's email"
                          onChange={(e) => {
                            const updated = [...data.occupants];
                            updated[i] = { ...occ, email: e.target.value };
                            set("occupants", updated);
                          }}
                        />
                      </div>
                    )}
                    <div style={styles.field}>
                      <label style={styles.label}>Photo of License</label>
                      {occ.license_photo_url ? (
                        <div style={{ fontSize: 13, color: "#166534" }}>
                          ✓ Uploaded{" "}
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...data.occupants];
                              updated[i] = { ...occ, license_photo_url: "" };
                              set("occupants", updated);
                            }}
                            style={{
                              marginLeft: 8,
                              fontSize: 12,
                              color: "#c00",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          style={styles.input}
                          disabled={uploadingSlot === `occupant_${i}`}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handlePhotoUpload(
                                file,
                                `occupant_${i}`,
                                (url) => {
                                  const updated = [...data.occupants];
                                  updated[i] = {
                                    ...occ,
                                    license_photo_url: url,
                                  };
                                  set("occupants", updated);
                                }
                              );
                            }
                          }}
                        />
                      )}
                      {uploadingSlot === `occupant_${i}` && (
                        <span style={{ fontSize: 12, color: "#777" }}>
                          Uploading...
                        </span>
                      )}
                    </div>
                  </div>
                  {age !== null && (
                    <div style={{ fontSize: 12, color: "#777" }}>
                      Age: {age}{" "}
                      {age >= 18
                        ? "— counts toward background check fee"
                        : "— minor, no background check needed"}
                    </div>
                  )}
                  {age !== null &&
                    age >= 18 &&
                    (!occ.license_number || !occ.license_photo_url) && (
                      <div style={{ fontSize: 12, color: "#c00", marginTop: 4 }}>
                        License # and photo are required for adult occupants.
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={data.vehicles_enabled}
            onChange={(e) => set("vehicles_enabled", e.target.checked)}
          />
          I have a vehicle/car that will be parked at the property
        </label>
        {data.vehicles_enabled && (
          <div>
            {[0, 1, 2].map((i) => {
              const veh = data.vehicles[i] ?? {
                vehicle_make: "",
                vehicle_model: "",
                vehicle_year: "",
                color: "",
                license_plate: "",
                license_state: "",
              };
              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 10,
                  }}
                >
                  <div style={styles.row}>
                    <div style={styles.field}>
                      <label style={styles.label}>Vehicle {i + 1} Make</label>
                      <input
                        style={styles.input}
                        value={veh.vehicle_make}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, vehicle_make: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Model</label>
                      <input
                        style={styles.input}
                        value={veh.vehicle_model}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, vehicle_model: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Year</label>
                      <input
                        style={styles.input}
                        value={veh.vehicle_year}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, vehicle_year: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Color</label>
                      <input
                        style={styles.input}
                        value={veh.color}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, color: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>License Plate #</label>
                      <input
                        style={styles.input}
                        value={veh.license_plate}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, license_plate: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>License State</label>
                      <input
                        style={styles.input}
                        value={veh.license_state}
                        onChange={(e) => {
                          const updated = [...data.vehicles];
                          updated[i] = { ...veh, license_state: e.target.value };
                          set("vehicles", updated);
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, marginTop: 4 }}>
          RV / Unit Information
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>RV Make</label>
            <input
              style={styles.input}
              value={data.rv_make}
              onChange={(e) => set("rv_make", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>RV Model</label>
            <input
              style={styles.input}
              value={data.rv_model}
              onChange={(e) => set("rv_model", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Year</label>
            <input
              style={styles.input}
              value={data.rv_year}
              onChange={(e) => set("rv_year", e.target.value)}
            />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>
              Length (ft){" "}
              {selectedLot?.max_length_ft && (
                <span style={{ fontWeight: 400, color: "#999" }}>
                  (max {selectedLot.max_length_ft} ft for this lot)
                </span>
              )}
            </label>
            <input
              type="number"
              style={{
                ...styles.input,
                borderColor: rvTooLong ? "#c00" : "#ccc",
              }}
              value={data.rv_length_ft}
              onChange={(e) => set("rv_length_ft", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>VIN / License Tag</label>
            <input
              style={styles.input}
              value={data.rv_vin_or_tag}
              onChange={(e) => set("rv_vin_or_tag", e.target.value)}
            />
          </div>
        </div>
        {rvTooLong && (
          <div
            style={{
              fontSize: 13,
              color: "#c00",
              fontWeight: 600,
              marginBottom: 12,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "8px 12px",
            }}
          >
            This RV ({data.rv_length_ft} ft) is too long for this lot (max{" "}
            {selectedLot?.max_length_ft} ft). Please choose a different lot
            or double-check the length entered.
          </div>
        )}
        {selectedLot?.max_width_ft && (
          <div style={{ fontSize: 12, color: "#777", marginBottom: 12 }}>
            This lot's max width: {selectedLot.max_width_ft} ft
            {selectedLot.amp_service ? ` · ${selectedLot.amp_service} amp service` : ""}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, marginTop: 16 }}>
          Utilities
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Utilities Included by Landlord</label>
          <input
            style={styles.input}
            placeholder="e.g. water, trash, electric charge trigger applies"
            value={data.utilities_included}
            onChange={(e) => set("utilities_included", e.target.value)}
          />
        </div>
      </div>

      {/* 11-13. Parking, Pets, Smoking */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Parking, Pets &amp; Smoking</div>

        {mode === "admin" ? (
          <>
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.parking_provided}
                onChange={(e) => set("parking_provided", e.target.checked)}
              />
              Parking provided
            </label>
            {data.parking_provided && (
              <div style={styles.row}>
                <div style={styles.field}>
                  <label style={styles.label}># of Spaces</label>
                  <input
                    style={styles.input}
                    placeholder="e.g. 2 - Lot A5"
                    value={data.parking_spaces}
                    onChange={(e) => set("parking_spaces", e.target.value)}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Parking Sticker Name/#</label>
                  <input
                    style={styles.input}
                    placeholder="e.g. Aloha-2026-014"
                    value={data.parking_sticker_name}
                    onChange={(e) =>
                      set("parking_sticker_name", e.target.value)
                    }
                  />
                </div>
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={data.parking_free}
                    onChange={(e) => set("parking_free", e.target.checked)}
                  />
                  Free (included in rent)
                </label>
                {!data.parking_free && (
                  <div style={styles.field}>
                    <label style={styles.label}>Parking Cost ($)</label>
                    <input
                      type="number"
                      style={styles.input}
                      value={data.parking_cost}
                      onChange={(e) => set("parking_cost", e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={data.pets_allowed}
                onChange={(e) => set("pets_allowed", e.target.checked)}
              />
              Pets permitted
            </label>
            {data.pets_allowed && (
              <>
                <div style={styles.field}>
                  <label style={styles.label}>Breed/Pet Restrictions</label>
                  <input
                    style={styles.input}
                    placeholder="e.g. No Pit Bulls or aggressive breeds"
                    value={data.pet_restrictions}
                    onChange={(e) =>
                      set("pet_restrictions", e.target.value)
                    }
                  />
                </div>
                <div style={styles.row}>
                  <div style={styles.field}>
                    <label style={styles.label}>
                      # of Pets{" "}
                      <span style={{ fontWeight: 400, color: "#999" }}>
                        (filled in by applicant)
                      </span>
                    </label>
                    <input
                      type="number"
                      style={styles.input}
                      value={data.pets_count}
                      onChange={(e) => set("pets_count", e.target.value)}
                    />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>
                      Pet Type(s){" "}
                      <span style={{ fontWeight: 400, color: "#999" }}>
                        (filled in by applicant)
                      </span>
                    </label>
                    <input
                      style={styles.input}
                      value={data.pets_types}
                      onChange={(e) => set("pets_types", e.target.value)}
                    />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Pet Fee/Deposit ($)</label>
                    <input
                      type="number"
                      style={styles.input}
                      value={data.pet_deposit}
                      onChange={(e) => set("pet_deposit", e.target.value)}
                      placeholder="0 if none"
                      disabled={!isMasterAdmin}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#333", lineHeight: 1.6, marginBottom: 12 }}>
            <div>
              <strong>Parking:</strong>{" "}
              {data.parking_provided
                ? `${data.parking_spaces} space(s), sticker ${data.parking_sticker_name || "TBD"}, ${
                    data.parking_free
                      ? "free"
                      : `$${data.parking_cost} (${data.parking_payment_timing.replace(
                          "_",
                          " "
                        )})`
                  }.`
                : "Not provided."}
            </div>
            <div>
              <strong>Pets:</strong>{" "}
              {data.pets_allowed ? (
                <>
                  Permitted. {data.pet_restrictions}
                  <div style={styles.row}>
                    <div style={styles.field}>
                      <label style={styles.label}># of Pets</label>
                      <input
                        type="number"
                        style={styles.input}
                        value={data.pets_count}
                        onChange={(e) =>
                          set("pets_count", e.target.value)
                        }
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Pet Type(s)</label>
                      <input
                        style={styles.input}
                        value={data.pets_types}
                        onChange={(e) =>
                          set("pets_types", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  {data.pet_deposit && Number(data.pet_deposit) > 0 && (
                    <div>${data.pet_deposit} fee/deposit applies.</div>
                  )}
                </>
              ) : (
                "Not permitted."
              )}
            </div>
          </div>
        )}

        <div style={styles.field}>
          <label style={styles.label}>Smoking Policy</label>
          <select
            style={styles.input}
            value={data.smoking_policy}
            onChange={(e) =>
              set("smoking_policy", e.target.value as SmokingPolicy)
            }
            disabled={mode !== "admin"}
          >
            <option value="prohibited">Prohibited everywhere</option>
            <option value="permitted_areas">Permitted in specific areas</option>
          </select>
        </div>
        {data.smoking_policy === "permitted_areas" && (
          <div style={styles.field}>
            <label style={styles.label}>Permitted Areas</label>
            <input
              style={styles.input}
              value={data.smoking_areas}
              onChange={(e) => set("smoking_areas", e.target.value)}
              disabled={mode !== "admin"}
            />
          </div>
        )}
      </div>

      {/* Additional Provisions */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Additional Terms</div>
        <div style={styles.field}>
          <label style={styles.label}>Additional Provisions</label>
          <textarea
            style={styles.textarea}
            value={data.additional_provisions}
            onChange={(e) => set("additional_provisions", e.target.value)}
          />
        </div>
      </div>

      {/* RV Removal Upon Termination */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>RV Removal Upon Termination</div>
        {mode === "admin" && (
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Days to Remove RV After Termination</label>
              <input
                type="number"
                style={styles.input}
                value={data.rv_removal_days}
                onChange={(e) => set("rv_removal_days", e.target.value)}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Daily Storage Fee if Not Removed ($)</label>
              <input
                type="number"
                style={styles.input}
                value={data.rv_removal_storage_fee}
                onChange={(e) =>
                  set("rv_removal_storage_fee", e.target.value)
                }
              />
            </div>
          </div>
        )}
        {mode === "admin" ? (
          <div style={styles.field}>
            <label style={styles.label}>Clause Text</label>
            <textarea
              style={{ ...styles.textarea, minHeight: 110 }}
              value={data.rv_removal_clause}
              onChange={(e) => set("rv_removal_clause", e.target.value)}
            />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#333", lineHeight: 1.5 }}>
            <strong>
              Tenant has {data.rv_removal_days} day(s) to remove the RV after
              termination.
            </strong>{" "}
            After that, a storage fee of ${data.rv_removal_storage_fee}/day
            may apply.
            <br />
            <br />
            {data.rv_removal_clause}
          </div>
        )}
      </div>

      {/* Park Rules & Community Guidelines */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Park Rules &amp; Community Guidelines</div>

        {data.park_rules.map((rule, idx) => (
          <div
            key={rule.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 14,
              marginBottom: 12,
            }}
          >
            {mode === "admin" ? (
              <>
                <div style={styles.row}>
                  <div style={styles.field}>
                    <label style={styles.label}>Rule Title</label>
                    <input
                      style={styles.input}
                      value={rule.title}
                      onChange={(e) => {
                        const updated = [...data.park_rules];
                        updated[idx] = { ...rule, title: e.target.value };
                        set("park_rules", updated);
                      }}
                    />
                  </div>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Rule Text</label>
                  <textarea
                    style={styles.textarea}
                    value={rule.text}
                    onChange={(e) => {
                      const updated = [...data.park_rules];
                      updated[idx] = { ...rule, text: e.target.value };
                      set("park_rules", updated);
                    }}
                  />
                </div>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "1px solid #c00",
                    color: "#c00",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    const updated = data.park_rules.filter(
                      (_, i) => i !== idx
                    );
                    set("park_rules", updated);
                  }}
                >
                  Remove Rule
                </button>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                  {rule.title}
                </div>
                <div style={{ fontSize: 13, color: "#333" }}>{rule.text}</div>
              </>
            )}
          </div>
        ))}

        {mode === "admin" && (
          <button
            type="button"
            style={{
              background: "none",
              border: "1px dashed #999",
              color: "#333",
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 13,
              cursor: "pointer",
              width: "100%",
              marginBottom: 8,
            }}
            onClick={() =>
              set("park_rules", [
                ...data.park_rules,
                {
                  id: `rule_${Date.now()}`,
                  title: "New Rule",
                  text: "",
                },
              ])
            }
          >
            + Add Another Rule
          </button>
        )}

        {mode === "applicant" && (
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={data.park_rules_acknowledged}
              onChange={(e) =>
                set("park_rules_acknowledged", e.target.checked)
              }
            />
            I have read and agree to follow the Park Rules &amp; Community
            Guidelines above.
          </label>
        )}
        {mode === "applicant" &&
          attemptedSubmit &&
          !data.park_rules_acknowledged && (
            <div style={styles.requiredNote}>Field required</div>
          )}
      </div>

      {/* Application Fee & Background Check */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Application Fee &amp; Background Check</div>

        {isMasterAdmin ? (
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Primary Applicant Fee ($)</label>
              <input
                type="number"
                style={styles.input}
                value={data.application_fee_primary}
                onChange={(e) =>
                  set("application_fee_primary", e.target.value)
                }
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Fee per Additional Adult ($)</label>
              <input
                type="number"
                style={styles.input}
                value={data.application_fee_per_additional}
                onChange={(e) =>
                  set("application_fee_per_additional", e.target.value)
                }
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "#333", marginTop: 0 }}>
            Every applicant must pass a background check before the lease is
            approved. This fee covers that check and is paid by the
            applicant.
          </p>
        )}

        <div
          style={{
            background: "#f7f7f7",
            borderRadius: 8,
            padding: 14,
            marginTop: 4,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          <strong>Total Application Fee: $
            {(
              (Number(data.application_fee_primary) || 0) +
              (Number(data.application_fee_per_additional) || 0) *
                additionalAdultsCount
            ).toFixed(2)}
          </strong>
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
            ${data.application_fee_primary} (primary applicant) + $
            {data.application_fee_per_additional} x {additionalAdultsCount}{" "}
            additional adult(s) age 18+ listed in Occupants above
          </div>
        </div>

        {mode === "applicant" && (
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={data.background_check_consent_given}
              onChange={(e) =>
                set("background_check_consent_given", e.target.checked)
              }
            />
            I authorize {company.name} to obtain a consumer background report
            on me (and any additional adult occupants listed above) for
            purposes of evaluating this rental application, and I
            acknowledge the application fee is non-refundable once the
            background check has been initiated.
          </label>
        )}
        {mode === "applicant" &&
          attemptedSubmit &&
          !data.background_check_consent_given && (
            <div style={styles.requiredNote}>Field required</div>
          )}
      </div>

      {/* Signature - applicant only */}
      {mode === "applicant" && (
        <div style={styles.card}>
          <div style={styles.sectionTitle}>Signature</div>
          <div style={styles.field}>
            <label style={styles.label}>Type your full legal name</label>
            <input
              style={styles.input}
              value={data.tenant_signature_name}
              onChange={(e) => set("tenant_signature_name", e.target.value)}
              placeholder="e.g. John A. Smith"
            />
            {attemptedSubmit && !data.tenant_signature_name && (
              <div style={styles.requiredNote}>Field required</div>
            )}
          </div>
          {data.tenant_signature_name && (
            <div
              style={{
                fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                fontSize: 34,
                color: "#1a1a1a",
                borderBottom: "1px solid #999",
                padding: "10px 4px 12px",
                marginBottom: 16,
              }}
            >
              {data.tenant_signature_name}
            </div>
          )}
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={data.tenant_signature_agreed}
              onChange={(e) =>
                set("tenant_signature_agreed", e.target.checked)
              }
            />
            I have reviewed this application and agree it is accurate.
          </label>
          {attemptedSubmit && !data.tenant_signature_agreed && (
            <div style={styles.requiredNote}>Field required</div>
          )}
        </div>
      )}

      <button
        style={{
          ...styles.submitBtn,
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
        disabled={submitting}
        onClick={() => {
          setAttemptedSubmit(true);
          if (!canSubmit) return;
          if (mode === "applicant") {
            setShowConfirmModal(true);
          } else {
            onSubmit({
              ...data,
              rent_due_day:
                data.rent_due_day || String(computedRentDueDay ?? ""),
              application_fee_additional_count: String(additionalAdultsCount),
            });
          }
        }}
      >
        {submitting
          ? "Submitting..."
          : mode === "applicant"
          ? "Submit Application"
          : "Save Application"}
      </button>

      {showConfirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 28,
              maxWidth: 440,
              width: "100%",
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>
              Before you continue
            </div>
            <p style={{ fontSize: 14, color: "#333", lineHeight: 1.5 }}>
              Please make sure you've included{" "}
              <strong>every adult and minor</strong> who will be living on
              the lot with you.
            </p>
            <p
              style={{
                fontSize: 14,
                color: "#c00",
                fontWeight: 700,
                lineHeight: 1.5,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              Occupants, RV Info &amp; Utilities → "Additional people besides
              the primary applicant"
            </p>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>
              If someone is missing, cancel and add them before submitting.
            </p>
            <div
              style={{
                background: "#f7f7f7",
                borderRadius: 8,
                padding: "12px 14px",
                marginBottom: 20,
                fontSize: 14,
              }}
            >
              You will be charged{" "}
              <strong>
                $
                {(
                  (Number(data.application_fee_primary) || 0) +
                  (Number(data.application_fee_per_additional) || 0) *
                    additionalAdultsCount
                ).toFixed(2)}
              </strong>{" "}
              for the application fee &amp; background check.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  background: "#fff",
                  color: "#333",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ✕ Go Back &amp; Check
              </button>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  onSubmit({
                    ...data,
                    rent_due_day:
                      data.rent_due_day || String(computedRentDueDay ?? ""),
                    application_fee_additional_count: String(
                      additionalAdultsCount
                    ),
                  });
                }}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#000",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                OK, Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
