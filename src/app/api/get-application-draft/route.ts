import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/get-application-draft?id=...&company_id=...
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
//
// Sep 29 (per Mely — found live: a Sep 23 application that had been
// archived by admin got silently resumed and carried through a real
// Stripe payment + Checkr invitation on Sep 29, still archived:true the
// whole time — invisible in the admin Applications tab despite real
// money changing hands). Two gaps fixed here:
//   1. `archived` wasn't filtered at all — an archived row was resumed
//      exactly as eagerly as a live one. Now excluded.
//   2. There was no `company_id` check — given a raw application id
//      (e.g. from a stale/shared `?application_id=` link), this could
//      return ANY company's application, not just the park whose site
//      the applicant is actually on. Now required and scoped.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!id || !companyId) {
    return NextResponse.json({ error: "id and company_id are required." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("resident_applications")
    .select("id, form_draft_json")
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("application_fee_paid", false)
    .or("archived.is.null,archived.eq.false")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  return NextResponse.json({ application: data });
}
