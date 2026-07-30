import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// POST /api/portal/request-move-out
// Body: { residentId, moveOutDate, note }
// Stores the resident's requested move-out date on their active lease as a
// REQUEST — it does not change lease_end directly, since ending a lease is
// an admin-confirmed action. Also notifies the admin so they see it right
// away instead of having to check the portal.
export async function POST(req: NextRequest) {
  const { residentId, moveOutDate, note } = await req.json();

  if (!residentId || !moveOutDate) {
    return NextResponse.json(
      { error: "residentId and moveOutDate are required." },
      { status: 400 }
    );
  }

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("company_id, full_name, space_id")
    .eq("id", residentId)
    .maybeSingle();

  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  const { data: lease, error: leaseError } = await supabase
    .from("resident_leases")
    .select("id")
    .eq("resident_id", residentId)
    .eq("status", "Active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError || !lease) {
    return NextResponse.json({ error: "No active lease found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("resident_leases")
    .update({
      requested_move_out_date: moveOutDate,
      requested_move_out_note: note || null,
      requested_move_out_at: new Date().toISOString(),
    })
    .eq("id", lease.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let lotName: string | null = null;
  if (resident.space_id) {
    const { data: lot } = await supabase
      .from("rv_lots")
      .select("lot_name")
      .eq("id", resident.space_id)
      .maybeSingle();
    lotName = lot?.lot_name || null;
  }

  await supabase.from("resident_update_notifications").insert({
    company_id: resident.company_id,
    resident_name: resident.full_name,
    update_type: "move_out_request",
    message: `${resident.full_name}${lotName ? ` (Lot ${lotName})` : ""} requested a move-out date: ${moveOutDate}.`,
  });

  return NextResponse.json({ success: true });
}
