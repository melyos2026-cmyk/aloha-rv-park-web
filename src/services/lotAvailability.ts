import { supabase } from "@/lib/supabase";

export type BlockedRange = { range_start: string; range_end: string };

export async function getLotBlockedRanges(lotId: string): Promise<BlockedRange[]> {
  const { data, error } = await supabase.rpc("get_lot_blocked_ranges", { p_lot_id: lotId });
  if (error) {
    console.error("Error fetching blocked ranges:", error);
    return [];
  }
  return data || [];
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
