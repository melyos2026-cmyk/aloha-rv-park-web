"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
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

    const { data, error } = await supabase
      .from("resident_electric_readings")
      .select("*")
      .eq("resident_id", residentId)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(error.message);
      return;
    }
    setReadings(data || []);
    setMessage("");
  }

  const filteredReadings = readings.filter(r =>
    (r.billing_month || "").toLowerCase().includes(searchMonth.toLowerCase())
  );

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
            <p style={{ color: "var(--gray)", fontSize: 14 }}>No electric history found.</p>
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
