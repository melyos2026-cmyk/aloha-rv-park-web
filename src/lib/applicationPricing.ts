// Oct 20 (security review): server-side copy of the lease-application
// pricing math, so the public application routes no longer trust amounts
// computed in the applicant's browser.
//
// Every function here is a deliberate, line-for-line mirror of the client
// code it replaces — keep them in sync by hand if the form changes:
//   - calculateProration / isDateInSeason / getSeasonalRent /
//     calculateLeaseRent  -> src/components/LeaseApplicationForm.tsx
//   - fee + background-check rules -> handleSubmit in src/app/apply/page.tsx
//   - form defaults (75 / 50 / 2.50 / 15 days) -> emptyForm in
//     LeaseApplicationForm.tsx (used when Lease Defaults never saved a value)
// (LeaseApplicationForm is a client component and can't be imported here.)

export type LotPricing = {
  id: string;
  company_id?: string | null;
  base_price: number | null;
  high_season_price: number | null;
  low_season_price: number | null;
  daily_rate?: number | null;
  weekly_rate?: number | null;
  use_seasonal_pricing?: boolean | null;
};

const FORM_DEFAULTS: Record<string, any> = {
  application_fee_primary: "75.00",
  application_fee_per_additional: "50.00",
  application_processing_fee: "2.50",
  background_check_threshold_days: "15",
  first_month_proration_method: "prorate_monthly",
  security_deposit_enabled: false,
  security_deposit_amount: "",
};

// The value the applicant's form starts with for a Lease Defaults key:
// `{ ...emptyForm, ...lease_defaults }` — a key saved in Lease Defaults
// (even "" or null) wins over the form's built-in default.
export function leaseDefaultValue(leaseDefaults: Record<string, any> | null | undefined, key: string): any {
  if (leaseDefaults && typeof leaseDefaults === "object" && leaseDefaults[key] !== undefined) {
    return leaseDefaults[key];
  }
  return FORM_DEFAULTS[key];
}

export function calculateProration(
  leaseStartDate: string,
  monthlyRent: number,
  method: string = "prorate_monthly",
  dailyRate?: number | null
): number | null {
  if (!leaseStartDate || monthlyRent <= 0) return null;
  const start = new Date(leaseStartDate + "T00:00:00");
  if (isNaN(start.getTime())) return null;
  const year = start.getFullYear();
  const month = start.getMonth();
  const dayOfMonth = start.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (dayOfMonth === 1) return monthlyRent;
  const daysUsed = daysInMonth - dayOfMonth + 1;
  return method === "daily_rate" && dailyRate
    ? Math.round(dailyRate * daysUsed * 100) / 100
    : Math.round((monthlyRent / daysInMonth) * daysUsed * 100) / 100;
}

function isDateInSeason(dateStr: string, startMonthDay: string, endMonthDay: string): boolean {
  const [, m, d] = dateStr.split("-").map(Number);
  const [startM, startD] = startMonthDay.split("-").map(Number);
  const [endM, endD] = endMonthDay.split("-").map(Number);
  const toComparable = (mm: number, dd: number) => mm * 100 + dd;
  const target = toComparable(m, d);
  const start = toComparable(startM, startD);
  const end = toComparable(endM, endD);
  if (start <= end) return target >= start && target <= end;
  return target >= start || target <= end;
}

function getSeasonalRent(
  lot: LotPricing,
  leaseStartDate: string,
  highSeasonStartMonthDay?: string | null,
  highSeasonEndMonthDay?: string | null
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
  return isDateInSeason(leaseStartDate, highSeasonStartMonthDay, highSeasonEndMonthDay)
    ? lot.high_season_price
    : lot.low_season_price;
}

export function calculateLeaseRent(
  lot: LotPricing,
  startDate: string,
  endDate: string,
  monthToMonth: boolean,
  highSeasonStartMonthDay?: string | null,
  highSeasonEndMonthDay?: string | null
): number | null {
  if (!startDate) return null;
  if (monthToMonth) return getSeasonalRent(lot, startDate, highSeasonStartMonthDay, highSeasonEndMonthDay);
  if (!endDate) return null;
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  const nights = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (nights < 7) return lot.daily_rate != null ? lot.daily_rate * nights : null;
  if (nights < 30) {
    if (lot.weekly_rate == null) return null;
    const fullWeeks = Math.floor(nights / 7);
    const extraDays = nights % 7;
    const dailyRateForExtra = lot.daily_rate ?? lot.weekly_rate / 7;
    return lot.weekly_rate * fullWeeks + dailyRateForExtra * extraDays;
  }
  return getSeasonalRent(lot, startDate, highSeasonStartMonthDay, highSeasonEndMonthDay);
}

// Every rent value the applicant's form can legitimately end up with for
// this lot + dates (the applicant can't type rent; the form fills it from
// the lot). Both the seasonal/stay calculation and the lot's base price are
// accepted, because a lot pre-filled by an invite (never re-selected) uses
// the form's seasonal flag rather than the lot's own.
export function allowedRentValues(
  lot: LotPricing | null,
  leaseStart: string | null,
  leaseEnd: string | null,
  highSeasonStart: string | null | undefined,
  highSeasonEnd: string | null | undefined,
  leaseDefaultsRent: number
): number[] {
  if (!lot) return [0, leaseDefaultsRent];
  const computed = calculateLeaseRent(
    lot,
    leaseStart || "",
    leaseEnd || "",
    !leaseEnd,
    highSeasonStart,
    highSeasonEnd
  );
  const values: number[] = [];
  if (computed !== null) values.push(Number(computed) || 0);
  if (lot.base_price != null) values.push(Number(lot.base_price) || 0);
  // The park's own pricing can't produce a number for these dates (missing
  // rates) → the form leaves rent blank (0) or whatever Lease Defaults held.
  if (computed === null) values.push(0, leaseDefaultsRent);
  return values;
}

export function matchesAny(value: number, allowed: number[], tolerance = 1): boolean {
  return allowed.some((a) => Math.abs((Number(value) || 0) - (Number(a) || 0)) <= tolerance);
}

function calculateAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

// Same rule as the form's additionalAdultsCount.
export function countAdditionalAdults(occupants: any): number {
  if (!Array.isArray(occupants)) return 0;
  return occupants.filter((occ) => {
    const age = calculateAge(String(occ?.date_of_birth || ""));
    return String(occ?.name || "").trim() !== "" && age !== null && age >= 18;
  }).length;
}

// Same rule as apply/page.tsx handleSubmit.
export function computeBackgroundCheckRequired(opts: {
  leaseStart: string | null;
  leaseEnd: string | null;
  thresholdDays: number;
  isFamilyFriend: boolean;
  isReturningResident: boolean;
  backgroundCheckOverride: string | null;
}): boolean {
  const stayNights =
    opts.leaseStart && opts.leaseEnd
      ? Math.round(
          (new Date(opts.leaseEnd + "T00:00:00").getTime() - new Date(opts.leaseStart + "T00:00:00").getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : null;
  // No end date = month-to-month (the form only leaves lease_end empty for month-to-month).
  const monthToMonth = !opts.leaseEnd;
  const automatic = monthToMonth || (stayNights !== null && stayNights > opts.thresholdDays);
  if (opts.isFamilyFriend) return false;
  if (opts.isReturningResident && opts.backgroundCheckOverride === "skip") return false;
  if (opts.isReturningResident && opts.backgroundCheckOverride === "required") return true;
  return automatic;
}

// Same fee fields apply/page.tsx used to compute in the browser.
export function computeApplicationFees(opts: {
  leaseDefaults: Record<string, any> | null | undefined;
  backgroundCheckRequired: boolean;
  additionalCount: number;
}) {
  const primary = Number(leaseDefaultValue(opts.leaseDefaults, "application_fee_primary")) || 0;
  const perAdditional = Number(leaseDefaultValue(opts.leaseDefaults, "application_fee_per_additional")) || 0;
  const processing = Number(leaseDefaultValue(opts.leaseDefaults, "application_processing_fee")) || 0;
  const bgTotal = opts.backgroundCheckRequired ? primary + perAdditional * opts.additionalCount : 0;
  return {
    application_fee_primary: primary,
    application_fee_per_additional: perAdditional,
    application_fee_additional_count: opts.additionalCount,
    application_fee_total: processing + bgTotal,
    application_processing_fee: processing,
    background_check_required: opts.backgroundCheckRequired,
    park_share_primary: opts.backgroundCheckRequired ? primary : 0,
    park_share_per_additional: opts.backgroundCheckRequired ? perAdditional : 0,
    park_share_total: bgTotal,
  };
}

// What's due today besides the fee when NO background check applies — the
// same stayAmountForCheckout / depositAmountForCheckout math as
// apply/page.tsx, from the (already server-validated) application row.
export function computeStayAndDeposit(opts: {
  backgroundCheckRequired: boolean;
  monthlyRent: number;
  securityDeposit: number;
  leaseStart: string | null;
  leaseEnd: string | null;
  prorationMethod: string;
  lotDailyRate: number | null;
}): { stayAmount: number; depositAmount: number } {
  if (opts.backgroundCheckRequired) return { stayAmount: 0, depositAmount: 0 };
  const fixedTerm = !!(opts.leaseStart && opts.leaseEnd);
  const stayAmount = fixedTerm
    ? Number(opts.monthlyRent) || 0
    : calculateProration(opts.leaseStart || "", Number(opts.monthlyRent) || 0, opts.prorationMethod, opts.lotDailyRate) || 0;
  return { stayAmount, depositAmount: Number(opts.securityDeposit) || 0 };
}
