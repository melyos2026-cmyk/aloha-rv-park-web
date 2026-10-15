export const RATE_TYPES = ["annual", "seasonal", "monthly", "transient_weekly", "transient_daily"] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const RATE_LABEL: Record<RateType, string> = {
  annual: "Annual",
  seasonal: "Seasonal",
  monthly: "Monthly",
  transient_weekly: "Weekly",
  transient_daily: "Daily",
};
