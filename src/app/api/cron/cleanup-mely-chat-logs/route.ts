import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

// GET /api/cron/cleanup-mely-chat-logs
// Sep 25 (per Mely — "despues de 24hr se puede borrar automatico"):
// these are ephemeral prospective-visitor/resident conversations with
// the public Mely widget, not a permanent record like a resident
// document — a genuine emergency reported through one is already
// captured separately in System Health + an immediate email the moment
// it happens, so keeping the raw chat text around indefinitely serves
// no purpose and is unnecessary personal-data retention. Runs daily,
// deletes anything older than 24 hours.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("mely_chat_logs")
    .delete()
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: data?.length || 0 });
}
