import { useEffect, useState } from "react";

/**
 * ApplicationFeeReport
 *
 * Shows the park admin (e.g. Yarinette) a transparent breakdown of every
 * application fee collected and what portion belongs to the park, so there's
 * never ambiguity about what she's owed. Read-only - the park_share_paid_out
 * flag is only updated by Mely (master_admin) once she's actually paid it out.
 *
 * Wire-up: pass a `fetchApplications` function that queries Supabase:
 *   supabase
 *     .from('lease_applications')
 *     .select('id, tenant_names, application_fee_total, park_share_total, park_share_paid_out, application_fee_paid, submitted_at')
 *     .eq('company_id', companyId)
 *     .order('submitted_at', { ascending: false })
 */

export interface ApplicationFeeRow {
  id: string;
  tenant_names: string;
  application_fee_total: number | null;
  park_share_total: number | null;
  application_fee_paid: boolean;
  park_share_paid_out: boolean;
  submitted_at: string | null;
}

interface Props {
  fetchApplications: () => Promise<ApplicationFeeRow[]>;
}

const styles = {
  wrap: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 900,
    margin: "0 auto",
    padding: "24px 20px",
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#666",
    marginBottom: 20,
  },
  summaryRow: {
    display: "flex",
    gap: 16,
    marginBottom: 20,
    flexWrap: "wrap" as const,
  },
  summaryCard: {
    flex: "1 1 200px",
    background: "#f7f7f7",
    borderRadius: 10,
    padding: "16px 18px",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: 700,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 14,
  },
  th: {
    textAlign: "left" as const,
    padding: "10px 12px",
    borderBottom: "2px solid #eee",
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase" as const,
    letterSpacing: "0.02em",
  },
  td: {
    padding: "12px",
    borderBottom: "1px solid #f0f0f0",
  },
  badge: (color: string, bg: string) => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color,
    background: bg,
  }),
};

export default function ApplicationFeeReport({ fetchApplications }: Props) {
  const [rows, setRows] = useState<ApplicationFeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApplications()
      .then(setRows)
      .catch((e) => setError(e?.message ?? "Failed to load applications"));
  }, [fetchApplications]);

  if (error) {
    return (
      <div style={styles.wrap}>
        <p style={{ color: "#c00" }}>Couldn't load applications: {error}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div style={styles.wrap}>
        <p style={{ color: "#777" }}>Loading...</p>
      </div>
    );
  }

  const totalCollected = rows.reduce(
    (sum, r) => sum + (r.application_fee_total ?? 0),
    0
  );
  const totalYourShare = rows.reduce(
    (sum, r) => sum + (r.park_share_total ?? 0),
    0
  );
  const totalOwed = rows
    .filter((r) => r.application_fee_paid && !r.park_share_paid_out)
    .reduce((sum, r) => sum + (r.park_share_total ?? 0), 0);

  return (
    <div style={styles.wrap}>
      <div style={styles.title}>Application Fees</div>
      <div style={styles.subtitle}>
        Every application fee collected, and your share of each one.
      </div>

      <div style={styles.summaryRow}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Total Collected (all-time)</div>
          <div style={styles.summaryValue}>${totalCollected.toFixed(2)}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Your Total Share</div>
          <div style={styles.summaryValue}>${totalYourShare.toFixed(2)}</div>
        </div>
        <div style={styles.summaryCard}>
          <div style={styles.summaryLabel}>Currently Owed to You</div>
          <div style={{ ...styles.summaryValue, color: "#b45309" }}>
            ${totalOwed.toFixed(2)}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "#777", fontSize: 14 }}>
          No applications yet. This list fills in as people apply.
        </p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Applicant</th>
              <th style={styles.th}>Fee Collected</th>
              <th style={styles.th}>Your Share</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={styles.td}>{r.tenant_names || "—"}</td>
                <td style={styles.td}>
                  ${(r.application_fee_total ?? 0).toFixed(2)}
                </td>
                <td style={styles.td}>
                  ${(r.park_share_total ?? 0).toFixed(2)}
                </td>
                <td style={styles.td}>
                  {!r.application_fee_paid ? (
                    <span style={styles.badge("#92400e", "#fef3c7")}>
                      Payment Pending
                    </span>
                  ) : r.park_share_paid_out ? (
                    <span style={styles.badge("#166534", "#dcfce7")}>
                      Paid to You
                    </span>
                  ) : (
                    <span style={styles.badge("#1e40af", "#dbeafe")}>
                      Owed to You
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
