import { supabaseAdmin } from "@/lib/supabase-admin";

import { RATE_TYPES, RATE_LABEL, type RateType } from "./rates";
export { RATE_TYPES, RATE_LABEL };
export type { RateType };

export type SlipRates = Partial<Record<RateType, { resident: number | null; non_resident: number | null }>>;

// Slip outline on the aerial map, as [x%, y%] corners. Uses the free-form shape when the
// marina drew one, otherwise the older rectangle (with its rotation).
function mapPoints(s: any): { points: [number, number][] } | null {
  const raw = s.map_shape;
  if (Array.isArray(raw) && raw.length >= 3) {
    const pts = raw.map((p: any) => [Number(p?.[0]), Number(p?.[1])] as [number, number]);
    if (pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return { points: pts };
  }
  const x = num(s.map_x), y = num(s.map_y), w = num(s.map_w), h = num(s.map_h);
  if (x === null || y === null || !w || !h) return null;
  const r = ((Number(s.map_r) || 0) * Math.PI) / 180, AX = 15.36, AY = 10.24;
  const cx = (x + w / 2) * AX, cy = (y + h / 2) * AY, hw = (w * AX) / 2, hh = (h * AY) / 2, c = Math.cos(r), sn = Math.sin(r);
  return {
    points: ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as [number, number][]).map(([px, py]) => [
      Math.round(((cx + px * c - py * sn) / AX) * 100) / 100,
      Math.round(((cy + px * sn + py * c) / AY) * 100) / 100,
    ] as [number, number]),
  };
}

export type SlipType = "wet" | "lift" | "dry";

export type PublicSlip = {
  id: string;
  slip_type: SlipType;
  photo: string | null;
  map: { points: [number, number][] } | null;
  slip_name: string;
  dock: string | null;
  length_ft: number | null;
  max_beam_ft: number | null;
  max_draft_ft: number | null;
  has_power: boolean;
  has_water: boolean;
  status: "available" | "occupied" | "reserved" | "maintenance";
  /** Occupied slips: the day the current contract ends and the slip opens. */
  available_from: string | null;
  /** Upcoming online bookings [start, end) so the calendar can show conflicts. */
  booked: [string, string][];
  rates: SlipRates;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Public slip board: only what a visitor should see. Notes, owners and boats
// are never included.
export async function loadPublicSlips(companyId: string): Promise<PublicSlip[]> {
  const holdSince = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [{ data: slips }, { data: rates }, { data: bookings }] = await Promise.all([
    supabaseAdmin
      .from("marina_slips")
      .select("*")
      .eq("company_id", companyId),
    supabaseAdmin
      .from("marina_slip_rates")
      .select("slip_id, rate_type, resident_rate, non_resident_rate")
      .eq("company_id", companyId),
    supabaseAdmin
      .from("marina_reservations")
      .select("slip_id, start_date, end_date, status, created_at")
      .eq("company_id", companyId)
      .in("status", ["confirmed", "pending"])
      .gte("end_date", todayET()),
  ]);

  const bookedBySlip = new Map<string, [string, string][]>();
  for (const b of bookings || []) {
    if (b.status === "pending" && b.created_at <= holdSince) continue;
    bookedBySlip.set(b.slip_id, [...(bookedBySlip.get(b.slip_id) || []), [b.start_date, b.end_date]]);
  }

  const ratesBySlip = new Map<string, SlipRates>();
  for (const r of rates || []) {
    const entry = ratesBySlip.get(r.slip_id) || {};
    entry[r.rate_type as RateType] = { resident: num(r.resident_rate), non_resident: num(r.non_resident_rate) };
    ratesBySlip.set(r.slip_id, entry);
  }

  return (slips || [])
    .map((s) => ({
      id: s.id,
      slip_type: (["wet", "lift", "dry"].includes(s.slip_type) ? s.slip_type : "wet") as SlipType,
      photo: typeof s.photo_url === "string" && s.photo_url ? s.photo_url : null,
      map: mapPoints(s),
      slip_name: s.slip_name,
      dock: s.dock || null,
      length_ft: num(s.length_ft),
      max_beam_ft: num(s.max_beam_ft),
      max_draft_ft: num(s.max_draft_ft),
      has_power: !!s.has_power,
      has_water: !!s.has_water,
      status: s.status as PublicSlip["status"],
      available_from: typeof s.available_from === "string" && s.available_from ? s.available_from : null,
      booked: (bookedBySlip.get(s.id) || []).sort((a, b) => a[0].localeCompare(b[0])),
      rates: ratesBySlip.get(s.id) || {},
    }))
    .sort((a, b) => (a.dock || "").localeCompare(b.dock || "") || a.slip_name.localeCompare(b.slip_name, undefined, { numeric: true }));
}

export type RateSummary = Partial<Record<RateType, { resident: number | null; non_resident: number | null }>>;

// "From" prices across every slip, for the rates table.
export function summarizeRates(slips: PublicSlip[]): RateSummary {
  const out: RateSummary = {};
  for (const type of RATE_TYPES) {
    let res: number | null = null;
    let non: number | null = null;
    for (const s of slips) {
      const r = s.rates[type];
      if (!r) continue;
      if (r.resident !== null && (res === null || r.resident < res)) res = r.resident;
      if (r.non_resident !== null && (non === null || r.non_resident < non)) non = r.non_resident;
    }
    if (res !== null || non !== null) out[type] = { resident: res, non_resident: non };
  }
  return out;
}

export type AccountInvoice = {
  id: string;
  invoice_number: string;
  category: string;
  description: string;
  amount: number;
  paid: number;
  balance: number;
  issue_date: string;
  due_date: string;
  status: "open" | "void";
  overdue: boolean;
};

export type AccountData = {
  member: { id: string; full_name: string; email: string | null };
  boats: {
    id: string; boat_name: string; make_model: string | null; length_ft: number | null; slip_name: string | null; dock: string | null;
    // Oct 21 (per Mely — Dry Stack): rack-stored boats can be requested into the water from the portal.
    dry: boolean;
    launch: { id: string; launch_at: string; return_at: string | null; status: string } | null;
  }[];
  invoices: AccountInvoice[];
  payments: { id: string; invoice_number: string; amount: number; method: string; received_at: string }[];
  totalDue: number;
};

export async function loadAccount(companyId: string, memberId: string): Promise<AccountData | null> {
  const { data: member } = await supabaseAdmin
    .from("marina_members")
    .select("id, full_name, email")
    .eq("id", memberId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!member) return null;

  const [{ data: boats }, { data: invoices }] = await Promise.all([
    supabaseAdmin
      .from("marina_boats")
      .select("id, boat_name, make_model, length_ft, slip_id")
      .eq("member_id", memberId)
      .eq("company_id", companyId),
    supabaseAdmin
      .from("marina_invoices")
      .select("id, invoice_number, category, description, amount, issue_date, due_date, status")
      .eq("member_id", memberId)
      .eq("company_id", companyId)
      .order("issue_date", { ascending: false }),
  ]);

  const slipIds = [...new Set((boats || []).map((b) => b.slip_id).filter(Boolean))] as string[];
  const { data: slips } = slipIds.length
    ? await supabaseAdmin.from("marina_slips").select("id, slip_name, dock, slip_type").eq("company_id", companyId).in("id", slipIds)
    : { data: [] as { id: string; slip_name: string; dock: string | null; slip_type: string | null }[] };
  const slipById = new Map((slips || []).map((s) => [s.id, s]));

  const invoiceIds = (invoices || []).map((i) => i.id);
  const { data: pays } = invoiceIds.length
    ? await supabaseAdmin
        .from("marina_invoice_payments")
        .select("id, invoice_id, amount, method, received_at, returned_at")
        .eq("company_id", companyId)
        .in("invoice_id", invoiceIds)
        .order("received_at", { ascending: false })
    : { data: [] as any[] };

  const paidBy = new Map<string, number>();
  for (const p of pays || []) {
    if (p.returned_at) continue;
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) || 0) + Number(p.amount));
  }

  const today = todayET();
  const list: AccountInvoice[] = (invoices || []).map((i) => {
    const paid = round2(paidBy.get(i.id) || 0);
    const amount = round2(Number(i.amount));
    const balance = i.status === "void" ? 0 : round2(Math.max(amount - paid, 0));
    return {
      id: i.id,
      invoice_number: i.invoice_number,
      category: i.category,
      description: i.description,
      amount,
      paid,
      balance,
      issue_date: i.issue_date,
      due_date: i.due_date,
      status: i.status,
      overdue: balance > 0 && i.due_date < today,
    };
  });

  const numberById = new Map(list.map((i) => [i.id, i.invoice_number]));

  // Open dry-stack trips for this boater's boats (table may not exist yet on older databases).
  const launchByBoat = new Map<string, { id: string; launch_at: string; return_at: string | null; status: string }>();
  const boatIds = (boats || []).map((b) => b.id);
  if (boatIds.length) {
    const { data: trips, error: tripErr } = await supabaseAdmin
      .from("marina_launch_requests")
      .select("id, boat_id, launch_at, return_at, status")
      .eq("company_id", companyId)
      .in("boat_id", boatIds)
      .in("status", ["requested", "confirmed", "in_water"])
      .order("launch_at");
    if (!tripErr) for (const t of trips || []) if (!launchByBoat.has(t.boat_id)) launchByBoat.set(t.boat_id, { id: t.id, launch_at: t.launch_at, return_at: t.return_at, status: t.status });
  }

  return {
    member: { id: member.id, full_name: member.full_name, email: member.email },
    boats: (boats || []).map((b) => {
      const s = b.slip_id ? slipById.get(b.slip_id) : null;
      return {
        id: b.id,
        boat_name: b.boat_name,
        make_model: b.make_model,
        length_ft: num(b.length_ft),
        slip_name: s?.slip_name || null,
        dock: s?.dock || null,
        dry: (s as any)?.slip_type === "dry",
        launch: launchByBoat.get(b.id) || null,
      };
    }),
    invoices: list.filter((i) => i.status === "open"),
    payments: (pays || [])
      .filter((p) => !p.returned_at)
      .map((p) => ({
        id: p.id,
        invoice_number: numberById.get(p.invoice_id) || "",
        amount: round2(Number(p.amount)),
        method: p.method,
        received_at: p.received_at,
      })),
    totalDue: round2(list.reduce((s, i) => s + i.balance, 0)),
  };
}


// Oct 21 (per Mely — Fuel Dock): fuel prices the marina chose to show on its website.
// Returns [] if the marina has none (or the table does not exist yet).
export async function loadFuelPrices(companyId: string): Promise<{ label: string; price_per_gallon: number; tax_included: boolean }[]> {
  const { data, error } = await supabaseAdmin
    .from("marina_fuel_prices")
    .select("label, price_per_gallon, tax_included")
    .eq("company_id", companyId)
    .eq("active", true)
    .eq("show_on_website", true)
    .order("sort");
  if (error || !data) return [];
  return data.map((f) => ({ label: f.label, price_per_gallon: Number(f.price_per_gallon), tax_included: !!f.tax_included }));
}
