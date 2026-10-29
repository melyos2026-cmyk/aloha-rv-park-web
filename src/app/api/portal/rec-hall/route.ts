import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";
import { addDays, checkRecHallRequest, normalizeRecHallRules, type RecHallRules, parkHM, parkToDate, parkToday, recHallWhen } from "@/lib/recHall";

// Oct 29 (per Mely): residents request the Rec Hall from the portal (free — no charge is ever added).
// GET  /api/portal/rec-hall?residentId=...&date=YYYY-MM-DD → switch state, the room, the resident's own
//      requests, and that day's taken times (times only — never other residents' names).
// POST { residentId, action: "request", date, start, end, title, guests, notes } → rv_events row with
//      status 'requested' (company + resident from the signed-in resident's row, never the client).
// POST { residentId, action: "cancel", id } → the resident withdraws a future requested/approved one.
// Admin side: melyos-builder Rec Hall module (approve → 'booked', decline → 'declined').
// Writes from "View as resident" are refused by requireMatchingSession. Before
// rec_hall_requests.sql (Supabase SQL) runs, the card says "not available yet" and POST returns 503.

const NOT_READY = "Rec Hall requests are not available yet.";
const OFF = "The Rec Hall can't be requested right now.";

const missing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || e.code === "PGRST204" || e.code === "23514" ||
    /does not exist|could not find|schema cache|violates check constraint/i.test(String(e.message || "")));

async function residentRow(id: string) {
  const { data } = await supabase.from("resident_accounts").select("id, company_id, full_name, email, phone, deleted_at").eq("id", id).maybeSingle();
  return data && data.company_id && !(data as any).deleted_at ? (data as any) : null;
}

// Switch + the company's request rules (lease_defaults.rec_hall_rules, edited in the admin Rec Hall
// module; missing/invalid → the defaults in src/lib/recHall.ts). A failed read = off.
async function recHallSettings(companyId: string): Promise<{ on: boolean; rules: RecHallRules }> {
  const { data, error } = await supabase.from("park_settings").select("lease_defaults").eq("company_id", companyId).maybeSingle();
  const ld = (data?.lease_defaults as Record<string, unknown> | null) || null;
  return { on: !error && ld?.clubhouse_enabled !== false, rules: normalizeRecHallRules(ld?.rec_hall_rules) };
}

/** The Rec Hall room: an active room named like "Rec Hall", else the first active room. */
async function recHallRoom(companyId: string) {
  const { data, error } = await supabase.from("rv_event_rooms").select("id, name, capacity, active").eq("company_id", companyId).eq("active", true).order("name");
  if (error || !data?.length) return { room: null, error };
  return { room: (data.find((r: any) => /rec\s*hall/i.test(String(r.name || ""))) || data[0]) as { id: string; name: string; capacity: number | null }, error: null };
}

/** The new columns from rec_hall_requests.sql exist (the status rule is changed in the same file). */
async function schemaReady(): Promise<boolean> {
  const { error } = await supabase.from("rv_events").select("id, guest_count, decline_reason, canceled_by").limit(1);
  return !error;
}

export async function GET(req: NextRequest) {
  const residentId = req.nextUrl.searchParams.get("residentId");
  if (!residentId) return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  const resident = await residentRow(residentId);
  if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const cid = resident.company_id as string;

  const noStore = { headers: { "Cache-Control": "no-store" } };
  const { on, rules } = await recHallSettings(cid);
  if (!on) return NextResponse.json({ enabled: false }, noStore);
  const { room } = await recHallRoom(cid);
  if (!room) return NextResponse.json({ enabled: false }, noStore);
  if (!(await schemaReady())) return NextResponse.json({ enabled: true, ready: false }, noStore);

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: mine } = await supabase.from("rv_events")
    .select("id, title, starts_at, ends_at, status, guest_count, notes, decline_reason, canceled_by")
    .eq("company_id", cid).eq("resident_id", residentId).gte("ends_at", since)
    .order("starts_at", { ascending: true }).limit(30);

  let day: { start: string; end: string; status: string; mine: boolean }[] = [];
  const date = req.nextUrl.searchParams.get("date") || "";
  const dayStart = parkToDate(date, "00:00"), dayEnd = parkToDate(addDays(date || "2000-01-01", 1), "00:00");
  if (dayStart && dayEnd) {
    const { data: taken } = await supabase.from("rv_events").select("starts_at, ends_at, status, resident_id")
      .eq("company_id", cid).eq("room_id", room.id).in("status", ["booked", "requested"])
      .lt("starts_at", dayEnd.toISOString()).gt("ends_at", dayStart.toISOString()).order("starts_at");
    day = (taken || []).map((e: any) => ({
      start: new Date(e.starts_at) < dayStart ? "00:00" : parkHM(e.starts_at),
      end: new Date(e.ends_at) > dayEnd ? "24:00" : parkHM(e.ends_at),
      status: e.status, mine: e.resident_id === residentId,
    }));
  }

  return NextResponse.json({
    enabled: true, ready: true,
    room: { name: room.name, capacity: room.capacity },
    rules: { ...rules, today: parkToday(), lastDay: addDays(parkToday(), rules.maxDaysAhead) },
    requests: mine || [], day,
  }, noStore);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const residentId = typeof body.residentId === "string" ? body.residentId : null;
  const authError = await requireMatchingSession(req, residentId);
  if (authError) return authError;
  const resident = await residentRow(residentId!);
  if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  const cid = resident.company_id as string;
  const who = resident.full_name || "A resident";

  if (body.action === "cancel") {
    const { data: ev } = await supabase.from("rv_events").select("id, status, starts_at, ends_at")
      .eq("id", String(body.id || "")).eq("company_id", cid).eq("resident_id", residentId!).maybeSingle();
    if (!ev) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    if (!["requested", "booked"].includes(ev.status) || new Date(ev.starts_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "This request can't be cancelled any more." }, { status: 409 });
    }
    const { error } = await supabase.from("rv_events").update({ status: "canceled", canceled_by: "resident" })
      .eq("id", ev.id).eq("company_id", cid).in("status", ["requested", "booked"]);
    if (missing(error)) return NextResponse.json({ error: NOT_READY, notReady: true }, { status: 503 });
    if (error) return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    await supabase.from("resident_update_notifications").insert({
      company_id: cid, resident_name: resident.full_name || null, update_type: "rec_hall_cancelled",
      message: `${who} cancelled their Rec Hall ${ev.status === "booked" ? "booking" : "request"} for ${recHallWhen(ev.starts_at, ev.ends_at)}.`,
    }).then(() => null, () => null);
    return NextResponse.json({ success: true });
  }

  if (body.action !== "request") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  // Admin switch off → no new requests (existing ones stay with the office).
  const { on, rules } = await recHallSettings(cid);
  if (!on) return NextResponse.json({ error: OFF, recHallOff: true }, { status: 403 });
  const { room } = await recHallRoom(cid);
  if (!room) return NextResponse.json({ error: OFF, recHallOff: true }, { status: 403 });
  if (!(await schemaReady())) return NextResponse.json({ error: NOT_READY, notReady: true }, { status: 503 });

  const title = String(body.title ?? "").trim().slice(0, 120);
  const notes = String(body.notes ?? "").trim().slice(0, 1000) || null;
  const check = checkRecHallRequest({ date: String(body.date || ""), start: String(body.start || ""), end: String(body.end || ""), title, guests: Number(body.guests), capacity: room.capacity }, new Date(), rules);
  if ("error" in check) return NextResponse.json({ error: check.error, vars: check.vars }, { status: 400 });
  const startIso = check.start.toISOString(), endIso = check.end.toISOString();

  // Rate limit: a few open requests per resident at a time.
  const { count, error: cErr } = await supabase.from("rv_events").select("id", { count: "exact", head: true })
    .eq("company_id", cid).eq("resident_id", residentId!).eq("status", "requested").gt("ends_at", new Date().toISOString());
  if (cErr) return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  if ((count || 0) >= rules.maxPending) {
    return NextResponse.json({ error: "You already have {n} requests waiting for the office. Please wait for an answer or cancel one.", vars: { n: rules.maxPending } }, { status: 429 });
  }

  // No overlap with an approved booking, or with the resident's own open request.
  const { data: clash } = await supabase.from("rv_events").select("id, status, resident_id")
    .eq("company_id", cid).eq("room_id", room.id).in("status", ["booked", "requested"])
    .lt("starts_at", endIso).gt("ends_at", startIso).limit(20);
  if ((clash || []).some((e: any) => e.status === "booked")) return NextResponse.json({ error: "The Rec Hall is already booked for part of that time. Please choose another time." }, { status: 409 });
  if ((clash || []).some((e: any) => e.resident_id === residentId)) return NextResponse.json({ error: "You already requested the Rec Hall for part of that time." }, { status: 409 });

  const guests = Number(body.guests);
  const { data: row, error } = await supabase.from("rv_events").insert({
    company_id: cid, room_id: room.id, resident_id: residentId,
    guest_name: resident.full_name || null, guest_email: resident.email || null, guest_phone: resident.phone || null,
    title, starts_at: startIso, ends_at: endIso, status: "requested", amount: null, notes,
    guest_count: guests,
  }).select("id").maybeSingle();
  if (missing(error)) return NextResponse.json({ error: NOT_READY, notReady: true }, { status: 503 });
  if (error || !row) return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });

  // Admin bell (+ phone/email per each admin's Notification Preferences: event "rec_hall_request").
  await supabase.from("resident_update_notifications").insert({
    company_id: cid, resident_name: resident.full_name || null, update_type: "rec_hall_request",
    message: `${who} requested the Rec Hall for ${recHallWhen(startIso, endIso)} — "${title.slice(0, 80)}", ${guests} guest${guests === 1 ? "" : "s"}. Approve or decline it in Rec Hall.`,
  }).then(() => null, () => null);

  return NextResponse.json({ success: true, id: row.id });
}
