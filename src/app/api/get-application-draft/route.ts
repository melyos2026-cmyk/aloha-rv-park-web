import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/get-application-draft?id=...
//
// Aug 20 (per Mely — "quise volver para atras haber la aplicacion que
// habia llenado y la aplicacion se me borraron los datos"): lets an
// applicant who already submitted once (and got sent to Stripe, or just
// navigated back) recover their own in-progress application instead of
// starting over from blank. Public/unauthenticated by design (same as
// get-application-invite) — an applicant filling out their own
// application has no session at all — but scoped to a single
// unguessable UUID, and only ever returns an application that hasn't
// been paid/approved yet (so this can't be used to peek at someone
// else's finished application by guessing IDs, and can't reopen
// something already locked in).
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("resident_applications")
    .select("id, form_draft_json")
    .eq("id", id)
    .eq("application_fee_paid", false)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  return NextResponse.json({ application: data });
}
