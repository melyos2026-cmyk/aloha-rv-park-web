import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getPortalSession } from "@/lib/portalSession";

// Oct 22 (security, per Mely): park announcements for the signed-in resident's own park only.
// The dashboard used to read them with the public key, which kept the table open to everyone.
export async function GET(req: NextRequest) {
  const session = await getPortalSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data: resident } = await supabase.from("resident_accounts").select("company_id").eq("id", session.residentId).maybeSingle();
  if (!resident?.company_id) return NextResponse.json({ announcements: [] });
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .eq("company_id", resident.company_id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ announcements: [] });
  return NextResponse.json({ announcements: data || [] });
}
