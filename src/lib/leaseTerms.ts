// Oct 26 (security review): the lease's legal terms (late/NSF fees, pet deposit, notice days, park
// rules, additional provisions, RV removal clause, utilities, payment instructions, parking cost…)
// are set by the PARK, not the applicant. The applicant form only displays them (they come from
// park_settings.lease_defaults, falling back to the form's built-in defaults). The server now
// fills them itself from the same source instead of accepting them from the browser.
//
// The fallback values below are a copy of emptyForm / defaultParkRules in
// src/components/LeaseApplicationForm.tsx (that file can't be imported here: it is a client
// component that imports CSS). Keep them in sync if the form's built-in defaults change.

const BUILT_IN: Record<string, any> = {
  notice_days: "15",
  rent_payment_instructions: "",
  late_fee_enabled: false,
  late_fee_amount: "",
  late_fee_grace_days: "",
  nsf_fee_enabled: false,
  nsf_fee_amount: "",
  utilities_included: "",
  hazardous_materials_clause:
    "Tenant may keep and use propane, gasoline, or other fuel that is factory-installed or normally used to operate the RV and its appliances (e.g., propane tanks connected to the RV's own system). Tenant agrees not to store any additional loose or spare fuel containers, gas cylinders, gasoline, kerosene, fireworks, or other flammable or explosive materials on the lot beyond what is necessary for the ordinary operation of the RV.",
  parking_provided: false,
  parking_spaces: "1",
  parking_free: true,
  parking_cost: "",
  parking_payment_timing: "monthly",
  pets_allowed: false,
  pet_deposit: "",
  pet_restrictions: "No aggressive or restricted breeds (e.g. Pit Bulls).",
  smoking_policy: "prohibited",
  smoking_areas: "",
  additional_provisions: "",
  rv_removal_days: "7",
  rv_removal_storage_fee: "25.00",
  rv_removal_clause:
    "Upon termination of this Agreement, Tenant shall remove the RV and all personal property from the lot within the number of days stated above. If the RV and/or personal property is not removed within that period, Park may treat the RV as abandoned, may charge a daily storage fee as stated above until removal, and/or may remove, store, and dispose of the RV and any remaining personal property in accordance with Florida law, at Tenant's sole expense. Park shall not be liable for any damage to the RV or personal property in connection with such removal or storage.",
};

const DEFAULT_PARK_RULES = [
  { id: "quiet_hours", title: "Quiet Hours", text: "Quiet hours are from 9:00 PM to 7:00 AM daily." },
  { id: "speed_limit", title: "Speed Limit", text: "Speed limit throughout the park is 5 mph at all times." },
  { id: "lot_appearance", title: "Lot & RV Appearance", text: "Tenant must keep the lot and the RV in clean, orderly condition at all times." },
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

// Columns that are lease terms, i.e. never taken from the applicant's browser.
export const PARK_LEASE_TERM_FIELDS = new Set([...Object.keys(BUILT_IN), "park_rules"]);

// The lease-term columns for an application, computed exactly like /apply/page.tsx does:
// form value = lease_defaults[key] if saved there, else the form's built-in default; numbers go
// through Number(x) || null like the page's row builder.
export function parkLeaseTerms(leaseDefaults: Record<string, any> | null | undefined): Record<string, any> {
  const d = leaseDefaults && typeof leaseDefaults === "object" ? leaseDefaults : {};
  const v = (k: string) => (d[k] !== undefined ? d[k] : BUILT_IN[k]);
  const num = (k: string) => Number(v(k)) || null;
  const rules = Array.isArray(d.park_rules) && d.park_rules.length > 0 ? d.park_rules : DEFAULT_PARK_RULES;
  return {
    notice_days: num("notice_days"),
    rent_payment_instructions: v("rent_payment_instructions"),
    late_fee_enabled: v("late_fee_enabled"),
    late_fee_amount: num("late_fee_amount"),
    late_fee_grace_days: num("late_fee_grace_days"),
    nsf_fee_enabled: v("nsf_fee_enabled"),
    nsf_fee_amount: num("nsf_fee_amount"),
    utilities_included: v("utilities_included"),
    hazardous_materials_clause: v("hazardous_materials_clause"),
    parking_provided: v("parking_provided"),
    parking_spaces: v("parking_spaces"),
    parking_free: v("parking_free"),
    parking_cost: num("parking_cost"),
    parking_payment_timing: v("parking_payment_timing"),
    pets_allowed: v("pets_allowed"),
    pet_deposit: num("pet_deposit"),
    pet_restrictions: v("pet_restrictions"),
    smoking_policy: v("smoking_policy"),
    smoking_areas: v("smoking_areas"),
    additional_provisions: v("additional_provisions"),
    rv_removal_days: num("rv_removal_days"),
    rv_removal_storage_fee: num("rv_removal_storage_fee"),
    rv_removal_clause: v("rv_removal_clause"),
    park_rules: rules,
  };
}
