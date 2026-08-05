"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
      setMessage(result.error || "Could not load electric history.");
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
      return month.includes(searchMonth.trim().toLowerCase());
    }
    return month.includes(currentYear);
  });

  const currentMonthName = new Date().toLocaleString("en-US", { month: "long" });

  const chartData = monthNames.map(monthName => {
    const reading = filteredReadings.find(item => item.billing_month?.startsWith(monthName));
    return {
      month: monthName.slice(0, 3),
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
            <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 4 }}>📊 Electric Usage History</h1>
            <p style={{ color: "var(--gray)", fontSize: 14 }}>Search and view your monthly electric readings.</p>
          </div>
          <button
            onClick={() => router.push("/residents/dashboard")}
            style={{ background: "var(--black)", color: "var(--white)", border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}>
            Back
          </button>
        </div>

        <div style={card}>
          <input
            placeholder="Search by month or year, example: June 2026"
            value={searchMonth}
            onChange={e => setSearchMonth(e.target.value)}
            style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 14, outline: "none" }}
          />
          {!isSearching && (
            <p style={{ fontSize: 13, color: "var(--gray)", marginTop: 10 }}>
              Showing readings for {currentYear}. Search above to find a different month or year.
            </p>
          )}
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>📊 Monthly Electric Usage</h2>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="usage" radius={[6, 6, 0, 0]} maxBarSize={35}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.isCurrent ? "#d3f8e2" : "#eeeeee"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {message && <p>{message}</p>}

        <div style={card}>
          {filteredReadings.length === 0 ? (
            <p style={{ color: "var(--gray)", fontSize: 14 }}>
              {readings.length === 0
                ? "No electric history found."
                : isSearching
                ? "No readings match your search."
                : `No electric readings for ${currentYear} yet.`}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredReadings.map(reading => (
                <details key={reading.id} style={{ border: "1.5px solid var(--border)", borderRadius: 6, padding: "10px 16px" }}>
                  <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 14 }}>{reading.billing_month || "Billing Month"}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>{reading.usage_kwh || 0} kWh</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 900, color: "#b91c1c", fontSize: 14 }}>${Number(reading.charge_amount || 0).toFixed(2)}</p>
                      <p style={{ color: "var(--gray)", fontSize: 12 }}>View details</p>
                    </div>
                  </summary>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 8, fontSize: 12, borderTop: "1.5px solid var(--border)", paddingTop: 8 }}>
                    <div>
                      <p style={{ color: "var(--gray)" }}>Reading</p>
                      <p style={{ fontWeight: 600 }}>{reading.previous_reading} → {reading.current_reading}</p>
                    </div>
                    <div>
                      <p style={{ color: "var(--gray)" }}>Included</p>
                      <p style={{ fontWeight: 600 }}>{reading.included_kwh || 0} kWh</p>
                    </div>
                    <div>
                      <p style={{ color: "var(--gray)" }}>Billable</p>
                      <p style={{ fontWeight: 600 }}>{reading.billable_kwh || 0} kWh</p>
                    </div>
                    <div>
                      <p style={{ color: "var(--gray)" }}>Rate</p>
                      <p style={{ fontWeight: 600 }}>${Number(reading.rate_per_kwh || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p style={{ color: "var(--gray)" }}>Meter</p>
                      <p style={{ fontWeight: 600 }}>{reading.meter_number || "N/A"}</p>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
