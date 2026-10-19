import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { requireMatchingSession } from "@/lib/portalSession";

// Oct 19 (per Mely — Aloha rule: golf carts must be insured and driven by a
// licensed driver). Residents manage their own golf carts in the portal.
//
// POST /api/portal/golf-carts  { residentId, action: "save", golfCarts: [...] }
//   → validates and saves resident_accounts.golf_carts, notifies the office.
// POST /api/portal/golf-carts  { residentId, action: "upload", fileName, fileDataBase64, contentType }
//   → stores the insurance copy in the PRIVATE license-photos bucket under
//     this resident's company folder and returns its storage path.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const clean = (v: any) => String(v ?? "").trim().slice(0, 200);

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { residentId, action } = body || {};
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const { data: resident } = await supabase
    .from("resident_accounts")
    .select("id, full_name, company_id, golf_carts")
    .eq("id", residentId)
    .maybeSingle();
  if (!resident) {
    return NextResponse.json({ error: "Resident not found." }, { status: 404 });
  }

  if (action === "upload") {
    const { fileName, fileDataBase64, contentType } = body;
    const type = String(contentType || "");
    if (!fileDataBase64 || !(type.startsWith("image/") || type === "application/pdf")) {
      return NextResponse.json({ error: "Please upload a photo or a PDF." }, { status: 400 });
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(fileDataBase64, "base64");
    } catch {
      return NextResponse.json({ error: "Invalid file data." }, { status: 400 });
    }
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File is empty or too large (15MB max)." }, { status: 400 });
    }
    const ext = (String(fileName || "").split(".").pop() || (type === "application/pdf" ? "pdf" : "jpg"))
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 5) || "jpg";
    const path = `${resident.company_id}/residents/${residentId}/golfcart-insurance-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("license-photos").upload(path, buf, { contentType: type });
    if (error) {
      return NextResponse.json({ error: "Could not upload file: " + error.message }, { status: 500 });
    }
    return NextResponse.json({ path });
  }

  if (action === "save") {
    const { data: settings } = await supabase
      .from("park_settings")
      .select("lease_defaults")
      .eq("company_id", resident.company_id)
      .maybeSingle();
    const ld: any = settings?.lease_defaults || {};
    const max = ld.golf_carts_max === undefined || ld.golf_carts_max === "" ? 2 : Number(ld.golf_carts_max) || 0;
    const insuranceRequired = ld.golf_cart_insurance_required !== false;

    const list: any[] = Array.isArray(body.golfCarts) ? body.golfCarts : [];
    if (list.length > max) {
      return NextResponse.json(
        { error: max === 0 ? "Golf carts are not allowed at this park." : `The park allows up to ${max} golf cart(s).` },
        { status: 400 }
      );
    }
    const prefix = `${resident.company_id}/`;
    const carts = list.map((g) => ({
      make: clean(g?.make),
      model: clean(g?.model),
      year: clean(g?.year),
      color: clean(g?.color),
      serial_or_tag: clean(g?.serial_or_tag),
      insurance_company: clean(g?.insurance_company),
      policy_number: clean(g?.policy_number),
      insurance_expiration: /^\d{4}-\d{2}-\d{2}$/.test(String(g?.insurance_expiration || "")) ? g.insurance_expiration : "",
      // only accept storage paths inside this company's own folder
      insurance_doc_path: String(g?.insurance_doc_path || "").startsWith(prefix) ? String(g.insurance_doc_path) : "",
    }));
    const incomplete = carts.some(
      (g) =>
        !g.make || !g.model || !g.year || !g.color || !g.insurance_company || !g.policy_number || !g.insurance_expiration ||
        (insuranceRequired && !g.insurance_doc_path)
    );
    if (incomplete) {
      return NextResponse.json(
        { error: `Please fill in make, model, year, color, insurance company, policy #, expiration date${insuranceRequired ? " and upload the insurance copy" : ""} for each golf cart.` },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("resident_accounts").update({ golf_carts: carts }).eq("id", residentId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (JSON.stringify(carts) !== JSON.stringify(resident.golf_carts || [])) {
      await supabase.from("resident_update_notifications").insert({
        company_id: resident.company_id,
        resident_id: residentId,
        resident_name: resident.full_name,
        update_type: "golf_cart_update",
        message:
          carts.length === 0
            ? `${resident.full_name} removed their golf cart(s).`
            : `${resident.full_name} updated their golf cart(s): ${carts
                .map((g) => `${g.year} ${g.make} ${g.model}, insurance expires ${g.insurance_expiration}`)
                .join("; ")}.`,
      });
    }
    return NextResponse.json({ success: true, golfCarts: carts });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
