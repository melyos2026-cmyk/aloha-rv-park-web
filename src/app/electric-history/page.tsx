"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLangSwitcher from "@/components/PortalLangSwitcher";
import { usePortalLang } from "@/lib/portalI18n";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ElectricHistoryPage() {
  const [readings, setReadings] = useState<any[]>([]);
  const [searchMonth, setSearchMonth] = useState("");
  const [message, setMessage] = useState("Loading...");
  const router = useRouter();
  // Oct 29 (per the owner): part of the resident portal — English / Spanish / Portuguese.
  const { lang, locale, t, money, dateLabel, err } = usePortalLang();

  useEffect(() => {
    loadElectricHistory();
  }, []);

  async function loadElectricHistory() {
    const residentId = localStorage.getItem("resident_id");
    if (!residentId) {
      router.push("/login");
      return;
    }

    const res = await fetch(`/api/portal/electric-history?residentId=${residentId}`);
    const result = await res.json();

    if (!res.ok) {
      setMessage(err(result.error) || t("Could not load electric history."));
      return;
    }
    setReadings(result.readings || []);
    setMessage("");
  }

  // Per Mely (Aug 4): same year-end archiving pattern already used for
  // Invoices/Payment History — the list only shows the CURRENT year by
  // default; once a year ends, its entries stay accessible but only via
  // search, keeping the panel clean for the new year. Computed from
  // today's actual date so it repeats correctly every Dec 31 → Jan 1
  // with no code changes needed, until the resident's account eventually
  // closes (they move out) and everything is deleted for good.
  const currentYear = String(new Date().getFullYear());
  const isSearching = searchMonth.trim().length > 0;
  const filteredReadings = readings.filter(r => {
    const month = (r.billing_month || "").toLowerCase();
    if (isSearching) {
      const q = searchMonth.trim().toLowerCase();
      return month.includes(q) || (lang !== "en" && dateLabel(r.billing_month || "").toLowerCase().includes(q));
    }
    return month.includes(currentYear);
  });

  const currentMonthName = new Date().toLocaleString("en-US", { month: "long" });

  const chartData = monthNames.map((monthName, mi) => {
    const reading = filteredReadings.find(item => item.billing_month?.startsWith(monthName));
    return {
      month: lang === "en" ? monthName.slice(0, 3) : new Date(Date.UTC(2000, mi, 1)).toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", ""),
      usage: Number(reading?.usage_kwh || 0),
      charge: Number(reading?.charge_amount || 0),
      isCurrent: monthName === currentMonthName,
    };
  });

  const card: React.CSSProperties = { background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 8, padding: 24 };

  return (
    <section style={{ padding: "60px 24px", background: "#f6f5f5", minHeight: "100vh" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 4 }}>{t("📊 Electric Usage History")}</h1>
            <p style={{ color: "var(--gray)", fontSize: 14 }}>{t("Search and view your monthly electric readings.")}</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <PortalLangSwitcher compact />
          <button
            onClick={() => router.push("/residents/dashboard")}
            style={{ background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
            {t("Back")}
          </button>
          </div>
        </div>

        <div style={card}>
          <input
            placeholder={t("Search by month or year, example: June 2026")}
            value={searchMonth}
            onChange={e => setSearchMonth(e.target.value)}
            style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, outline: "none" }}
          />
          {!isSearching && (
            <p style={{ fontSize: 13, color: "var(--gray)", marginTop: 10 }}>
              {t("Showing readings for {year}. Search above to find a different month or year.", { year: currentYear })}
            </p>
          )}
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>{t("📊 Monthly Electric Usage")}</h2>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => [`${v} kWh`, t("Used")]} />
                <Bar dataKey="usage" radius={[6, 6, 0, 0]} maxBarSize={35}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.isCurrent ? "#d3f8e2" : "#eeeeee"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {message && <p>{t(message)}</p>}

        <div style={card}>
          {filteredReadings.length === 0 ? (
            <p style={{ color: "var(--gray)", fontSize: 14 }}>
              {readings.length === 0
                ? t("No electric history found.")
                : isSearching
                ? t("No readings match your search.")
                : t("No electric readings for {year} yet.", { year: currentYear })}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredReadings.map(reading => (
                <details key={reading.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 16px" }}>
                  <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 14 }}>{reading.billing_month ? dateLabel(reading.billing_month) : t("Billing Month")}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{reading.usage_kwh || 0} kWh</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 900, color: "#b91c1c", fontSize: 14 }}>{money(reading.charge_amount)}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{t("View details")}</p>
                    </div>
                  </summary>

                  {(() => {
                    // Oct 20 (per Mely): residents always see the meter going UP
                    // and the kWh they used, whatever kind of meter it is — a
                    // meter that counts down (4500 → 3471) shows as 3471 → 4500,
                    // and a meter that resets to 0000 shows as 0 → its reading.
                    const used = Number(reading.usage_kwh ?? reading.current_reading ?? 0);
                    const included = Number(reading.included_kwh || 0);
                    const billable = Number(reading.billable_kwh || 0);
                    const rate = Number(reading.rate_per_kwh || 0);
                    const charge = Number(reading.charge_amount || 0);
                    const prevM = reading.previous_meter_reading;
                    const curM = reading.meter_reading;
                    let meterPair: string | null = null;
                    if (reading.meter_mode === "resets" && curM != null) meterPair = `0 → ${curM}`;
                    else if (curM != null && prevM != null) {
                      const lo = Math.min(Number(prevM), Number(curM));
                      const hi = Math.max(Number(prevM), Number(curM));
                      // Only when the difference matches the usage (not a 9999 → 0000 rollover).
                      if (Math.abs(hi - lo - used) < 0.01) meterPair = `${lo} → ${hi}`;
                    }
                    const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
                    const cell = (label: string, value: string) => (
                      <div>
                        <p style={{ color: "var(--gray)" }}>{label}</p>
                        <p style={{ fontWeight: 600 }}>{value}</p>
                      </div>
                    );
                    return (
                      <div style={{ marginTop: 8, borderTop: "1.5px solid var(--border)", paddingTop: 8, fontSize: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                          {meterPair && cell(t("Meter reading"), meterPair)}
                          {cell(t("Used"), `${fmt(used)} kWh`)}
                          {cell(t("Included"), `${fmt(included)} kWh`)}
                          {cell(t("Billable"), `${fmt(billable)} kWh`)}
                          {cell(t("Rate"), t("{amount} per kWh", { amount: money(rate) }))}
                          {reading.meter_number ? cell(t("Meter #"), reading.meter_number) : null}
                        </div>
                        <p style={{ marginTop: 10, color: "#374151" }}>
                          {(() => {
                            // Oct 20: parks that round electric to the dollar show the rounding.
                            const exact = Math.round(billable * rate * 100) / 100;
                            const total =
                              Math.abs(exact - charge) >= 0.01
                                ? t("{exact}, rounded to {charge}", { exact: money(exact), charge: money(charge) })
                                : money(charge);
                            return included > 0
                              ? t("{used} kWh used − {included} kWh included = {billable} kWh × {rate} = {total}", { used: fmt(used), included: fmt(included), billable: fmt(billable), rate: money(rate), total })
                              : `${fmt(billable)} kWh × ${money(rate)} = ${total}`;
                          })()}
                        </p>
                      </div>
                    );
                  })()}
                </details>
              ))}
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
