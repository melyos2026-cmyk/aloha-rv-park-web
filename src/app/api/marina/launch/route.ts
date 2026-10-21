import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";

// Oct 21 (per Mely — Dry Stack): a signed-in boater asks the marina to put their
// rack-stored boat in the water (and says when they will be back). It lands on
// the staff Launch Board in the admin as a "New request". POST creates, DELETE
// cancels the boater's own request while it is still only requested/confirmed.

async function sessionFor(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return { error: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const session = getMarinaSession(req);
  if (!session || session.companyId !== company.id) return { error: NextResponse.json({ error: "Please sign in again." }, { status: 401 }) };
  return { company, memberId: session.memberId };
}

export async function POST(req: Request) {
  const s = await sessionFor(req);
  if ("error" in s) return s.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const { data: boat } = await supabaseAdmin.from("marina_boats").select("id, member_id, slip_id")
    .eq("id", body.boat_id).eq("company_id", s.company.id).eq("member_id", s.memberId).maybeSingle();
  if (!boat) return NextResponse.json({ error: "Boat not found." }, { status: 404 });
  const { data: slip } = boat.slip_id
    ? await supabaseAdmin.from("marina_slips").select("slip_type").eq("id", boat.slip_id).eq("company_id", s.company.id).maybeSingle()
    : { data: null };
  if (slip?.slip_type !== "dry") return NextResponse.json({ error: "Launch requests are only for boats stored on a dry-stack rack." }, { status: 400 });

  const launch = new Date(body.launch_at);
  const now = Date.now();
  if (isNaN(launch.getTime()) || launch.getTime() < now - 15 * 60000) return NextResponse.json({ error: "Choose a launch time in the future." }, { status: 400 });
  if (launch.getTime() > now + 60 * 86400000) return NextResponse.json({ error: "Launches can be requested up to 60 days ahead." }, { status: 400 });
  const ret = body.return_at ? new Date(body.return_at) : null;
  if (ret && (isNaN(ret.getTime()) || ret <= launch)) return NextResponse.json({ error: "The return time must be after the launch time." }, { status: 400 });

  const { data: open } = await supabaseAdmin.from("marina_launch_requests").select("id")
    .eq("company_id", s.company.id).eq("boat_id", boat.id).in("status", ["requested", "confirmed", "in_water"]).limit(1);
  if (open?.length) return NextResponse.json({ error: "This boat already has a launch request. Cancel it first or call the office." }, { status: 409 });

  const { error } = await supabaseAdmin.from("marina_launch_requests").insert({
    company_id: s.company.id, boat_id: boat.id, member_id: s.memberId, slip_id: boat.slip_id,
    launch_at: launch.toISOString(), return_at: ret ? ret.toISOString() : null,
    status: "requested", source: "portal",
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 300) || null : null,
  });
  if (error) return NextResponse.json({ error: "Could not send the request. Please call the office." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await sessionFor(req);
  if ("error" in s) return s.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const { data: trip } = await supabaseAdmin.from("marina_launch_requests").select("id, status")
    .eq("id", body.id).eq("company_id", s.company.id).eq("member_id", s.memberId).maybeSingle();
  if (!trip) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (!["requested", "confirmed"].includes(trip.status)) return NextResponse.json({ error: "Your boat is already in the water. Call the office to change the return." }, { status: 409 });
  const { error } = await supabaseAdmin.from("marina_launch_requests").update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", trip.id).eq("company_id", s.company.id);
  if (error) return NextResponse.json({ error: "Could not cancel. Please call the office." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
