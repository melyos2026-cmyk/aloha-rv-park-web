// Oct 29 (per the owner — resident portal in English / Spanish / Portuguese): remembers the
// resident's portal language on their account, so it follows them to another phone or computer.
// POST { residentId, lang: "en" | "es" | "pt" | "fr" | "ht" } → { ok, saved }   (fr / ht added Oct 29)
// Optional column: resident_accounts.portal_language (see the SQL handed over with this change).
// Until it exists the update fails quietly and the portal keeps the choice in the browser only —
// nothing else depends on it. Not an office-facing change, so no resident_update_notifications row.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

const LANGS = new Set(["en", "es", "pt", "fr", "ht"]);

export async function POST(req: NextRequest) {
  const { residentId, lang } = await req.json().catch(() => ({}));
  const authError = await requireMatchingSession(req, residentId || null);
  if (authError) return authError;
  if (!LANGS.has(lang)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });

  const { error } = await supabase
    .from("resident_accounts")
    .update({ portal_language: lang })
    .eq("id", residentId);

  // Column not added yet (or any other failure): the browser still keeps the choice.
  return NextResponse.json({ ok: true, saved: !error });
}
