import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 27 (per Mely — "el mapa debe leer las reservaciones y cambiar según el calendario, no se
// debería hacer manual"): every slip's status is worked out from what's booked, for TODAY:
//  • Occupied  — a boat is kept in the slip, a signed contract covers today, or a confirmed
//                reservation covers today (or the office marked it Occupied until a date that hasn't
//                come yet). "Opens" = when that ends.
//  • Reserved  — held today (contract sent but not signed, a price quote, a reservation being paid)
//                or a booking starts in the next 7 days.
//  • Available — nothing of the above.
//  • Closed for repair (maintenance) is the only status the office sets by hand.
// Saved on marina_slips so the map, the admin, the dashboard and the AI all show the same thing.
// The same file is in the admin app: lib/marinaSlipStatus.ts — keep both in sync.

const lastRun = new Map<string, number>();
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function syncSlipStatuses(companyId: string, opts: { force?: boolean } = {}) {
  if (!opts.force && Date.now() - (lastRun.get(companyId) || 0) < 60_000) return; // at most once a minute
  lastRun.set(companyId, Date.now());
  try {
    const T = todayET(), soon = addDays(T, 7);
    const holdSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const [{ data: slips }, { data: res }, { data: ks }, { data: boats }, { data: quotes }] = await Promise.all([
      supabaseAdmin.from("marina_slips").select("*").eq("company_id", companyId),
      supabaseAdmin.from("marina_reservations").select("slip_id, start_date, end_date, status, created_at").eq("company_id", companyId).in("status", ["confirmed", "pending"]).gt("end_date", T),
      supabaseAdmin.from("marina_contracts").select("slip_id, start_date, end_date, status").eq("company_id", companyId).in("status", ["sent", "viewed", "signed"]).gte("end_date", T),
      supabaseAdmin.from("marina_boats").select("slip_id").eq("company_id", companyId).not("slip_id", "is", null),
      supabaseAdmin.from("marina_slip_requests").select("slip_id, start_date, end_date, status, quote_expires_at").eq("company_id", companyId).in("status", ["quoted", "quote_accepted"]).not("slip_id", "is", null).gte("end_date", T),
    ]);
    if (!slips) return;
    type R = { a: string; b: string; firm: boolean }; // [a, b) — b is the first free day
    const by = new Map<string, R[]>();
    const add = (id: string | null, r: R) => { if (id) by.set(id, [...(by.get(id) || []), r]); };
    for (const r of res || []) {
      if (r.status === "pending" && r.created_at <= holdSince) continue; // unpaid hold expired
      add(r.slip_id, { a: r.start_date, b: r.end_date, firm: r.status === "confirmed" });
    }
    for (const k of ks || []) if (k.start_date && k.end_date) add(k.slip_id, { a: k.start_date, b: addDays(k.end_date, 1), firm: k.status === "signed" });
    for (const q of quotes || []) {
      if (q.status === "quoted" && q.quote_expires_at && Date.parse(q.quote_expires_at) < Date.now()) continue;
      if (q.start_date && q.end_date) add(q.slip_id, { a: q.start_date, b: addDays(q.end_date, 1), firm: false });
    }
    const kept = new Set((boats || []).map((b: any) => b.slip_id));

    for (const s of slips as any[]) {
      if (s.status === "maintenance") continue; // set by hand
      const rs = by.get(s.id) || [];
      const now = rs.filter((r) => r.a <= T && T < r.b);
      const firmNow = now.filter((r) => r.firm);
      // a manual "Occupied until <date>" from the office still counts until that date
      const manual = s.status === "occupied" && s.status_source !== "auto" && (!s.available_from || s.available_from > T);
      let status: string, from: string | null = null, source = "auto";
      if (kept.has(s.id) || firmNow.length || manual) {
        status = "occupied";
        if (firmNow.length) {
          // the day it opens: the end of today's booking, following back-to-back bookings
          let end = firmNow.map((r) => r.b).sort().pop()!;
          for (let moved = true; moved;) { moved = false; for (const r of rs) if (r.firm && r.a <= end && r.b > end) { end = r.b; moved = true; } }
          from = end;
          // the office's own "Occupied until" date wins when it's later
          if (manual) { source = "manual"; if (!s.available_from || s.available_from > end) from = s.available_from || null; }
        } else if (manual) { from = s.available_from || null; source = "manual"; }
        else from = s.available_from && s.available_from > T ? s.available_from : null;
      } else if (now.length || rs.some((r) => r.a > T && r.a <= soon)) {
        status = "reserved";
      } else {
        status = "available";
      }
      if (status !== s.status || (from || null) !== (s.available_from || null) || ("status_source" in s && s.status_source !== source)) {
        const upd: Record<string, any> = { status, available_from: from };
        if ("status_source" in s) upd.status_source = source;
        await supabaseAdmin.from("marina_slips").update(upd).eq("id", s.id).eq("company_id", companyId).neq("status", "maintenance");
      }
    }
  } catch (e: any) {
    console.error("slip status sync:", e?.message);
  }
}
