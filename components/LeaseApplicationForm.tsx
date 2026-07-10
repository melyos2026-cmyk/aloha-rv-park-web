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

  property_address: string;

  lease_start_date: string;
  notice_days: string;

  rent_amount: string;
  rent_due_day: string;
  rent_payment_instructions: string;

  late_fee_enabled: boolean;
  late_fee_amount: string;
  late_fee_grace_days: string;

  security_deposit_enabled: boolean;
  security_deposit_amount: string;
  security_deposit_return_days: string;

  nsf_fee_enabled: boolean;
  nsf_fee_amount: string;

  occupants_enabled: boolean;
  occupants_names: string;

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

  pets_allowed: boolean;
  pets_count: string;
  pets_types: string;
  pet_deposit: string;

  smoking_policy: SmokingPolicy;
  smoking_areas: string;

  built_pre_1978: boolean;

  additional_provisions: string;

  rv_removal_days: string;
  rv_removal_storage_fee: string;
  rv_removal_clause: string;

  park_rules: ParkRule[];
  park_rules_acknowledged: boolean;

  tenant_signature_name: string;
  tenant_signature_agreed: boolean;
}

export interface ParkRule {
  id: string;
  title: string;
  text: string;
}

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
  property_address: "",
  lease_start_date: "",
  notice_days: "15",
  rent_amount: "",
  rent_due_day: "1",
  rent_payment_instructions: "",
  late_fee_enabled: false,
  late_fee_amount: "",
  late_fee_grace_days: "",
  security_deposit_enabled: false,
  security_deposit_amount: "",
  security_deposit_return_days: "15",
  nsf_fee_enabled: false,
  nsf_fee_amount: "",
  occupants_enabled: false,
  occupants_names: "",
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
  pets_allowed: false,
  pets_count: "",
  pets_types: "",
  pet_deposit: "",
  smoking_policy: "prohibited",
  smoking_areas: "",
  built_pre_1978: false,
  additional_provisions: "",
  rv_removal_days: "7",
  rv_removal_storage_fee: "25.00",
  rv_removal_clause:
    "Upon termination of this Agreement, Tenant shall remove the RV and all personal property from the lot within the number of days stated above. If the RV and/or personal property is not removed within that period, Park may treat the RV as abandoned, may charge a daily storage fee as stated above until removal, and/or may remove, store, and dispose of the RV and any remaining personal property in accordance with Florida law, at Tenant's sole expense. Park shall not be liable for any damage to the RV or personal property in connection with such removal or storage.",
  park_rules: defaultParkRules,
  park_rules_acknowledged: false,
  tenant_signature_name: "",
  tenant_signature_agreed: false,
};

interface Props {
  mode: "applicant" | "admin";
  initialData?: Partial<LeaseApplicationData>;
  onSubmit: (data: LeaseApplicationData) => Promise<void> | void;
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
};

export default function LeaseApplicationForm({
  mode,
  initialData,
  onSubmit,
  submitting,
}: Props) {
  const [data, setData] = useState<LeaseApplicationData>({
    ...emptyForm,
    ...initialData,
  });

  const set = <K extends keyof LeaseApplicationData>(
    key: K,
    value: LeaseApplicationData[K]
  ) => setData((prev) => ({ ...prev, [key]: value }));

  const canSubmit =
    data.landlord_name &&
    data.tenant_names &&
    data.property_address &&
    data.rent_amount &&
    (mode === "admin" ||
      (data.tenant_signature_name &&
        data.tenant_signature_agreed &&
        data.park_rules_acknowledged));

  return (
    <div style={styles.page}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        Aloha RV Park — Lease Application
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
            <label style={styles.label}>Landlord Name</label>
            <input
              style={styles.input}
              value={data.landlord_name}
              onChange={(e) => set("landlord_name", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Landlord Address</label>
            <input
              style={styles.input}
              value={data.landlord_address}
              onChange={(e) => set("landlord_address", e.target.value)}
            />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Tenant Name(s)</label>
            <input
              style={styles.input}
              placeholder="e.g. John Smith, Mary Smith"
              value={data.tenant_names}
              onChange={(e) => set("tenant_names", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Property / Lot Address</label>
            <input
              style={styles.input}
              value={data.property_address}
              onChange={(e) => set("property_address", e.target.value)}
            />
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
              onChange={(e) => set("lease_start_date", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Notice Period (days)</label>
            <input
              type="number"
              style={styles.input}
              value={data.notice_days}
              onChange={(e) => set("notice_days", e.target.value)}
            />
          </div>
        </div>
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>Monthly Rent ($)</label>
            <input
              type="number"
              style={styles.input}
              value={data.rent_amount}
              onChange={(e) => set("rent_amount", e.target.value)}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Rent Due Day</label>
            <input
              type="number"
              min={1}
              max={31}
              style={styles.input}
              value={data.rent_due_day}
              onChange={(e) => set("rent_due_day", e.target.value)}
            />
          </div>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Payment Instructions</label>
          <textarea
            style={styles.textarea}
            value={data.rent_payment_instructions}
            onChange={(e) => set("rent_payment_instructions", e.target.value)}
          />
        </div>
      </div>

      {/* 5-7. Fees & Deposits */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Fees &amp; Deposits</div>

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
                onChange={(e) => set("late_fee_grace_days", e.target.value)}
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

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, marginTop: 16 }}>
          Hazardous Materials
        </div>
        {mode === "admin" ? (
          <textarea
            style={styles.textarea}
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

        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={data.occupants_enabled}
            onChange={(e) => set("occupants_enabled", e.target.checked)}
          />
          Additional occupants besides the tenant(s)
        </label>
        {data.occupants_enabled && (
          <div style={styles.field}>
            <label style={styles.label}>Occupant Names</label>
            <input
              style={styles.input}
              value={data.occupants_names}
              onChange={(e) => set("occupants_names", e.target.value)}
            />
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
            <label style={styles.label}>Length (ft)</label>
            <input
              type="number"
              style={styles.input}
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
                type="number"
                style={styles.input}
                value={data.parking_spaces}
                onChange={(e) => set("parking_spaces", e.target.value)}
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
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}># of Pets</label>
              <input
                type="number"
                style={styles.input}
                value={data.pets_count}
                onChange={(e) => set("pets_count", e.target.value)}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Pet Types</label>
              <input
                style={styles.input}
                value={data.pets_types}
                onChange={(e) => set("pets_types", e.target.value)}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Pet Deposit ($)</label>
              <input
                type="number"
                style={styles.input}
                value={data.pet_deposit}
                onChange={(e) => set("pet_deposit", e.target.value)}
              />
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
            />
          </div>
        )}
      </div>

      {/* 31-32. Disclosures & Additional Provisions */}
      <div style={styles.card}>
        <div style={styles.sectionTitle}>Disclosures &amp; Additional Terms</div>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={data.built_pre_1978}
            onChange={(e) => set("built_pre_1978", e.target.checked)}
          />
          Structure was built prior to 1978 (lead-based paint disclosure required)
        </label>
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
            />
          </div>
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
        </div>
      )}

      <button
        style={{
          ...styles.submitBtn,
          opacity: canSubmit && !submitting ? 1 : 0.5,
          cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
        }}
        disabled={!canSubmit || submitting}
        onClick={() => onSubmit(data)}
      >
        {submitting
          ? "Submitting..."
          : mode === "applicant"
          ? "Submit Application"
          : "Save Application"}
      </button>
    </div>
  );
}
