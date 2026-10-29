import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { hostnameFromRequest } from "@/lib/marina/host";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { parkLimitsFromLots, rvFitsPark, tooBigMessage, type ParkLimits } from "@/lib/rvWaitlistFit";

// Oct 28 (per Mely): public "Join the waitlist" for RV parks (aloharvparkfl.com). It only opens when
// the park is FULL — every lot taken, not counting storage spaces (S1–S6 / a "Storage" section).
// The company always comes from the website's own domain, never from the request body, so nobody
// can add names to another park's list. Rows land in rv_waitlist, the office's Waitlist screen.

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;
const STAYS = ["monthly", "seasonal", "annual"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[<>]/g, "").trim().slice(0, max) : "");
const feet = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n * 10) / 10 : null;
};
const isStorage = (l: { lot_name?: string | null; section_name?: string | null }) =>
  /storage/i.test(String(l.section_name || "")) || /^S\d+$/i.test(String(l.lot_name || "").trim());

async function rvParkForRequest(req: Request) {
  const host = hostnameFromRequest(req);
  if (!host) return null;
  const { data } = await supabaseAdmin.from("public_company_profile").select("id, company_name, business_type, domain").eq("domain", host).maybeSingle();
  if (!data || String(data.business_type || "").toLowerCase() === "marina") return null;
  return data as { id: string; company_name: string; business_type: string | null; domain: string };
}

// Full = there is at least one (non-storage) lot and none of them is available right now.
// Uses the same live lot status the public map and the Apply form use.
// Oct 28 (per Mely): also returns the size limits of the rentable lots (length + slide-outs per
// side, as the office saved them) so an RV that no lot can take is turned away up front.
async function parkState(companyId: string): Promise<{ full: boolean; limits: ParkLimits } | null> {
  const { data: lots, error } = await supabaseAdmin.from("rv_lots")
    .select("id, lot_name, section_name, status, max_length_ft, max_driver_slide_outs, max_passenger_slide_outs").eq("company_id", companyId);
  if (error || !lots) return null;
  const { data: live, error: liveErr } = await supabaseAdmin.rpc("get_live_lot_statuses", { p_company_id: companyId });
  if (liveErr) return null;
  const liveById: Record<string, string> = {};
  (live || []).forEach((r: any) => { liveById[r.lot_id] = r.live_status; });
  const rentable = (lots as any[]).filter((l) => !isStorage(l));
  const limits = parkLimitsFromLots(rentable);
  if (!rentable.length) return { full: false, limits };
  return { full: !rentable.some((l) => (liveById[l.id] || l.status) === "available"), limits };
}

export async function GET(req: Request) {
  const park = await rvParkForRequest(req);
  if (!park) return NextResponse.json({ full: false });
  const st = await parkState(park.id);
  const full = st?.full === true;
  // Only the size limits (no lot names, ids or statuses) — and only when the waitlist is open.
  return NextResponse.json(full ? { full, limits: st!.limits } : { full }, { headers: { "Cache-Control": "no-store" } });
}

const slides = (v: unknown): number | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  return n <= 10 ? n : null;
};

export async function POST(req: Request) {
  const park = await rvParkForRequest(req);
  if (!park) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  // Hidden field real people never fill in; bots do. Pretend it worked.
  if (text(body.website, 100)) return NextResponse.json({ ok: true });

  const fullName = text(body.full_name, 120);
  const email = text(body.email, 160).toLowerCase();
  const phone = text(body.phone, 40);
  if (fullName.length < 2) return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (phone && phone.replace(/\D/g, "").length < 10) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });

  // Oct 28 (per Mely): RV size is required — length and both slide-out counts (0 is fine).
  const length = feet(body.rv_length_ft);
  const driver = slides(body.rv_driver_slide_outs);
  const passenger = slides(body.rv_passenger_slide_outs);
  if (length === null) return NextResponse.json({ error: "Enter your RV length in feet." }, { status: 400 });
  if (driver === null) return NextResponse.json({ error: "Choose how many driver-side slide-outs your RV has (0 if none)." }, { status: 400 });
  if (passenger === null) return NextResponse.json({ error: "Choose how many passenger-side slide-outs your RV has (0 if none)." }, { status: 400 });

  const st = await parkState(park.id);
  if (st === null) return NextResponse.json({ error: "Could not save your request. Please try again or call the office." }, { status: 503 });
  const full = st.full;
  if (!full) return NextResponse.json({ error: "Good news — there are lots available right now. Please apply instead.", available: true }, { status: 409 });

  const rv = { length, driver, passenger };
  if (!rvFitsPark(st.limits, rv)) return NextResponse.json({ error: tooBigMessage(st.limits, rv), tooBig: true, limits: st.limits }, { status: 400 });

  // Flood guards: 60 sign-ups per park per hour, 5 per device per hour.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabaseAdmin.from("rv_waitlist").select("id", { count: "exact", head: true }).eq("company_id", park.id).gte("created_at", since);
  if ((count || 0) >= 60) return NextResponse.json({ error: "Too many requests right now. Please call the office." }, { status: 429 });
  if (await tooManyFromIp(req, `rv-waitlist:${park.id}`, 5)) return NextResponse.json({ error: "Too many requests from this device. Please call the office." }, { status: 429 });

  // Already on the list with this email: confirm without a duplicate (exact match, no wildcards).
  const { data: same } = await supabaseAdmin.from("rv_waitlist").select("id, email").eq("company_id", park.id).in("status", ["waiting", "offered"]).eq("email", email).limit(1);
  if (same?.length) return NextResponse.json({ ok: true });

  const { data: last } = await supabaseAdmin.from("rv_waitlist").select("position").eq("company_id", park.id).order("position", { ascending: false, nullsFirst: false }).limit(1);
  const position = (Number(last?.[0]?.position) || 0) + 1;
  const amp = ["30A", "50A"].includes(String(body.amp_needed)) ? String(body.amp_needed) : null;
  const stay = STAYS.includes(String(body.stay_type)) ? String(body.stay_type) : "monthly";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(body.desired_start || "")) ? String(body.desired_start) : null;
  const notes = text(body.notes, 1000);
  const row: Record<string, any> = {
    company_id: park.id, full_name: fullName, email, phone: phone || null,
    rv_length_ft: length, rv_type: text(body.rv_type, 60) || null, amp_needed: amp,
    rv_driver_slide_outs: driver, rv_passenger_slide_outs: passenger,
    desired_start: start, stay_type: stay, pets: text(body.pets, 200) || null,
    notes: `Joined from the website.${notes ? ` ${notes}` : ""}`.slice(0, 1000),
    status: "waiting", position,
  };
  let { error } = await supabaseAdmin.from("rv_waitlist").insert(row);
  // The slide-out columns come from rv_waitlist_slides.sql — until it runs, save without them
  // (the counts go into the notes so the office still sees them).
  if (error && /slide_outs/i.test(`${error.message} ${(error as any).details || ""}`)) {
    const { rv_driver_slide_outs: _d, rv_passenger_slide_outs: _p, ...rest } = row;
    rest.notes = `${rest.notes} Slide-outs: ${driver} driver-side, ${passenger} passenger-side.`.slice(0, 1000);
    ({ error } = await supabaseAdmin.from("rv_waitlist").insert(rest));
  }
  if (error) return NextResponse.json({ error: "Could not save your request. Please try again or call the office." }, { status: 500 });
  // Oct 29 (per Mely — Notification Preferences): tell the office in the admin bell. Best-effort;
  // a repeat sign-up with the same email returned above, so this is once per person.
  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: park.id, resident_name: fullName, update_type: "waitlist_signup",
    message: `${fullName} joined the waitlist (#${position}) — ${length} ft RV, ${stay}${start ? `, from ${start}` : ""}.`,
  }).then(() => null, () => null);
  return NextResponse.json({ ok: true });
}
