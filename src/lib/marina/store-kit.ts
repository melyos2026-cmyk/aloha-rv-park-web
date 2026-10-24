// Shared by the store page (browser) and the order API (server) — no server imports here.
// Oct 24: price of a kit for the parts kept — the full-kit price when every part is kept, else the parts' sum.
export function kitPrice(fullPrice: number, parts: { key: string; price: number }[], keep: string[]): number {
  const chosen = parts.filter((p) => keep.includes(p.key));
  if (!chosen.length) return 0;
  const sum = Math.round(chosen.reduce((a, p) => a + p.price, 0) * 100) / 100;
  return chosen.length === parts.length ? Math.min(fullPrice, sum) : sum;
}

// Cart/order line for a kit: the kept part keys joined with "+" (sorted so the same kit is one line).
export const kitLineKey = (keep: string[]) => [...keep].sort().join("+");
export const kitKeys = (line: string) => String(line || "").split("+").map((k) => k.trim()).filter(Boolean);
