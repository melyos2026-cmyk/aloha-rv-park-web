export type BlockedRange = { range_start: string; range_end: string };

export async function getLotBlockedRanges(lotId: string): Promise<BlockedRange[]> {
  // Aug 21 (per Mely — real double-booking risk found live): routed
  // through Service Role — see get-lot-blocked-ranges/route.ts for why
  // this direct anon-key RPC call was silently missing 2 of its 4 real
  // data sources (lot_orders, resident_leases — both RLS-blocked for
  // anon with no policy at all).
  try {
    const res = await fetch(`/api/get-lot-blocked-ranges?lotId=${encodeURIComponent(lotId)}`);
    const json = await res.json();
    if (!res.ok) {
      console.error("Error fetching blocked ranges:", json?.error);
      return [];
    }
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error("Error fetching blocked ranges:", err);
    return [];
  }
}

export function isRangeAvailable(blocked: BlockedRange[], start: Date, end: Date): boolean {
  return !blocked.some((b) => {
    const bStart = new Date(b.range_start + "T00:00:00");
    const bEnd = new Date(b.range_end + "T00:00:00");
    return start < bEnd && end > bStart;
  });
}

export function getExcludedIntervals(blocked: BlockedRange[]) {
  return blocked.map((b) => ({
    start: new Date(b.range_start + "T00:00:00"),
    end: new Date(b.range_end + "T00:00:00"),
  }));
}
