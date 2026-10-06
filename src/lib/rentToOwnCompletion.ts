import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminSessionForCompany } from "@/lib/adminSession";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/admin/rent-to-own-plans?company_id=...&deleted=true|false
// Aug 5 (per Mely — pre-launch audit): the client-side version used
// Supabase's embedded-relationship syntax (`resident_accounts(full_name)`)
// — the same syntax that silently broke Recurring Charges a few days ago
// (needs a registered FK relationship in PostgREST's schema cache that
// doesn't exist) — PLUS it separately queried resident_accounts with the
// anon key, which blocks anon reads via RLS. Either issue alone could
// have made Rent-to-Own Plans silently show empty. Also fixes lot_name,
// which was declared on the type but never actually populated anywhere.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  const deleted = req.nextUrl.searchParams.get("deleted") === "true";

  if (!companyId) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }

  const sessionToken = req.headers.get("x-admin-session");
  if (sessionToken && !verifyAdminSessionForCompany(sessionToken, companyId)) {
    return NextResponse.json({ error: "Not authorized for this company." }, { status: 403 });
  }

  let query = supabaseAdmin
    .from("rent_to_own_plans")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  query = deleted ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

  const { data: plans, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!plans || plans.length === 0) {
    return NextResponse.json({ plans: [] });
  }

  const residentIds = Array.from(new Set(plans.map((p) => p.resident_id).filter(Boolean)));
  const { data: residents } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, full_name, space_id")
    .in("id", residentIds);

  const residentMap: Record<string, { full_name: string; space_id: string | null }> = {};
  (residents || []).forEach((r) => {
    residentMap[r.id] = { full_name: r.full_name, space_id: r.space_id };
  });

  const spaceIds = (residents || []).map((r) => r.space_id).filter(Boolean) as string[];
  let lotMap: Record<string, string> = {};
  if (spaceIds.length > 0) {
    const { data: lots } = await supabaseAdmin
      .from("rv_lots")
      .select("id, lot_name")
      .in("id", spaceIds);
    (lots || []).forEach((l: any) => {
      lotMap[l.id] = l.lot_name;
    });
  }

  const result = [];
  for (const plan of plans) {
    const { data: paidInvoices } = await supabaseAdmin
      .from("resident_invoices")
      .select("id")
      .eq("resident_id", plan.resident_id)
      .eq("status", "Paid");

    let paidSoFar = 0;
    const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
    if (invoiceIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("resident_invoice_items")
        .select("amount")
        .in("invoice_id", invoiceIds)
        .eq("charge_type", "Rent-to-Own Principal");
      paidSoFar = (items || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);
    }

    const resident = residentMap[plan.resident_id];
    result.push({
      ...plan,
      resident_name: resident?.full_name || "Unknown",
      lot_name: resident?.space_id ? lotMap[resident.space_id] || null : null,
      paid_so_far: Number(plan.starting_paid_amount || 0) + paidSoFar,
    });
  }

  return NextResponse.json({ plans: result });
}

// POST /api/admin/rent-to-own-plans
// Body: { action: 'create', companyId, residentId, lotId, totalPrice, monthlyPrincipal, startingPaidAmount }
//    or { action: 'complete-check', companyId, residentId }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, companyId } = body;
  if (!action || !companyId) {
    return NextResponse.json({ error: "action and companyId are required." }, { status: 400 });
  }
  const sessionToken = req.headers.get("x-admin-session");
  if (sessionToken && !verifyAdminSessionForCompany(sessionToken, companyId)) {
    return NextResponse.json({ error: "Not authorized for this company." }, { status: 403 });
  }

  if (action === "create") {
    const { residentId, lotId, totalPrice, monthlyPrincipal, startingPaidAmount, depositPaymentMethod, recurringChargeId } = body;
    if (!residentId || totalPrice == null || monthlyPrincipal == null) {
      return NextResponse.json({ error: "residentId, totalPrice, and monthlyPrincipal are required." }, { status: 400 });
    }
    const { data: insertedPlan, error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .insert({
        company_id: companyId,
        resident_id: residentId,
        lot_id: lotId,
        total_price: totalPrice,
        monthly_principal: monthlyPrincipal,
        starting_paid_amount: startingPaidAmount || 0,
        // Aug 20 (per Mely, found investigating why John Smith's
        // approval sent no invoice/email): this route already existed
        // and was already Service-Role — the lease-approval flow in
        // services/leaseApplications.ts just never used it, writing
        // directly with the anon key instead (silently blocked once
        // rent_to_own_plans' RLS gap was closed Aug 19). Added the one
        // field that route was missing (deposit_payment_method) instead
        // of duplicating this insert logic elsewhere.
        deposit_payment_method: depositPaymentMethod || null,
        // Aug 27 (per Mely — full RTO cycle verification): finally
        // stores the real link to the plan's own $/mo recurring charge
        // — was always left null before, since the caller never passed
        // it and this column was just never populated by anything.
        recurring_charge_id: recurringChargeId || null,
        status: "active",
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, planId: insertedPlan?.id });
  }

  if (action === "complete-check") {
    return handleCompleteCheck(body);
  }

  if (action === "sign") {
    return handleSign(body);
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// PATCH /api/admin/rent-to-own-plans
// Body: { action: 'update'|'cancel'|'soft-delete'|'restore'|'bulk-soft-delete', companyId, ...fields }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { action, companyId, id } = body;
  if (!action || !companyId) {
    return NextResponse.json({ error: "action and companyId are required." }, { status: 400 });
  }
  const sessionToken = req.headers.get("x-admin-session");
  if (sessionToken && !verifyAdminSessionForCompany(sessionToken, companyId)) {
    return NextResponse.json({ error: "Not authorized for this company." }, { status: 403 });
  }

  async function assertOwnership(planId: string) {
    const { data } = await supabaseAdmin.from("rent_to_own_plans").select("company_id").eq("id", planId).maybeSingle();
    return !!data && data.company_id === companyId;
  }

  if (action === "update") {
    const { lotId, totalPrice, monthlyPrincipal, startingPaidAmount } = body;
    if (!id || !(await assertOwnership(id))) {
      return NextResponse.json({ error: "Plan not found for this company." }, { status: 404 });
    }
    const { error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .update({
        lot_id: lotId,
        total_price: totalPrice,
        monthly_principal: monthlyPrincipal,
        starting_paid_amount: startingPaidAmount || 0,
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // Sep 18 (per Mely — "que pasa si el admin cometió un error en el bill
  // of sale"): lets a mistake (wrong RV info on file, wrong clauses,
  // etc.) actually get corrected — clears both signatures and puts the
  // plan back to "pending_signatures" so both parties re-sign the
  // corrected version. Deliberately does NOT touch recurring_charges —
  // the money already stopped when the plan was first paid off, and a
  // paperwork correction should never restart billing. The OLD flawed
  // PDF stays in Documents until the new one is signed and generated,
  // at which point the existing "replace, don't accumulate" fix quietly
  // swaps it out.
  if (action === "redo-bill-of-sale") {
    if (!id || !(await assertOwnership(id))) {
      return NextResponse.json({ error: "Plan not found for this company." }, { status: 404 });
    }
    const { error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .update({
        status: "pending_signatures",
        resident_signed_at: null,
        resident_signature_name: null,
        admin_signed_at: null,
        admin_signature_name: null,
      })
      .eq("id", id)
      .eq("status", "completed");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "cancel") {
    if (!id || !(await assertOwnership(id))) {
      return NextResponse.json({ error: "Plan not found for this company." }, { status: 404 });
    }
    const { data: cancelledPlan, error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", id)
      .select("resident_id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Aug 27 (per Mely — full RTO cycle verification, same root cause as
    // the payoff-completion fix in aloha-rv-park-web's
    // rentToOwnCompletion.ts): cancelling a plan never stopped the
    // underlying $/mo recurring charge either — a resident who backed out
    // of a Rent-to-Own purchase would have kept being billed the
    // principal payment indefinitely with no connection to the plan
    // they'd just cancelled.
    if (cancelledPlan?.resident_id) {
      await supabaseAdmin
        .from("recurring_charges")
        .update({ active: false })
        .eq("resident_id", cancelledPlan.resident_id)
        .eq("charge_type", "Rent-to-Own Principal")
        .eq("active", true);
    }
    return NextResponse.json({ success: true });
  }

  if (action === "soft-delete" || action === "restore") {
    if (!id || !(await assertOwnership(id))) {
      return NextResponse.json({ error: "Plan not found for this company." }, { status: 404 });
    }
    const { error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .update({ deleted_at: action === "soft-delete" ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "bulk-soft-delete") {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids (array) is required." }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("rent_to_own_plans")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids)
      .eq("company_id", companyId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// DELETE /api/admin/rent-to-own-plans?id=...&company_id=...  (single, permanent)
// DELETE /api/admin/rent-to-own-plans?ids=id1,id2&company_id=...  (bulk, permanent)
export async function DELETE(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  const id = req.nextUrl.searchParams.get("id");
  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!companyId || (!id && !idsParam)) {
    return NextResponse.json({ error: "company_id and (id or ids) are required." }, { status: 400 });
  }
  const sessionToken = req.headers.get("x-admin-session");
  if (sessionToken && !verifyAdminSessionForCompany(sessionToken, companyId)) {
    return NextResponse.json({ error: "Not authorized for this company." }, { status: 403 });
  }

  const ids = idsParam ? idsParam.split(",") : [id!];
  const { error } = await supabaseAdmin.from("rent_to_own_plans").delete().in("id", ids).eq("company_id", companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// Aug 19 (per Mely — Real Estate/RTO audit, closing the last open anon
// policy on rent_to_own_plans): checkAndCompleteRentToOwnPlan used to run
// entirely client-side with the anon key — including generating the Bill
// of Sale PDF (jsPDF), uploading it to Storage, and creating the resident
// document. Moved the WHOLE thing server-side. One real snag: the
// original used the browser's FileReader to convert the fetched logo
// image to a data URL — that API doesn't exist in Node, replaced with
// Buffer.toString("base64") instead, same end result.
async function handleCompleteCheck(body: any) {
  const { companyId, residentId } = body;
  if (!residentId) {
    return NextResponse.json({ error: "residentId is required." }, { status: 400 });
  }

  const { data: plan } = await supabaseAdmin
    .from("rent_to_own_plans")
    .select("id, total_price, lot_id, starting_paid_amount, status")
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .in("status", ["active", "pending_signatures"])
    .is("deleted_at", null)
    .maybeSingle();

  if (!plan) return NextResponse.json({ success: true, completed: false });
  // Already past the payoff-detection step (deactivated + waiting on
  // signatures) — nothing new to do here, sign-bill-of-sale handles the rest.
  if (plan.status === "pending_signatures") {
    return NextResponse.json({ success: true, completed: false, pendingSignatures: true });
  }

  let paidSoFar = Number(plan.starting_paid_amount || 0);
  const { data: paidInvoices } = await supabaseAdmin
    .from("resident_invoices")
    .select("id")
    .eq("resident_id", residentId)
    .eq("status", "Paid");
  const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
  if (invoiceIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from("resident_invoice_items")
      .select("amount")
      .in("invoice_id", invoiceIds)
      .eq("charge_type", "Rent-to-Own Principal");
    paidSoFar += (items || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);
  }

  if (paidSoFar < Number(plan.total_price)) {
    return NextResponse.json({ success: true, completed: false });
  }

  // Sep 16 (per Mely — Bill of Sale redesign): payoff detection no
  // longer generates the PDF immediately — it only stops the money
  // (deactivating the recurring charge, which must NEVER wait on
  // anything else) and moves the plan to "pending_signatures". The
  // actual Bill of Sale document is only generated once BOTH the
  // resident and the admin have digitally signed (see the new "sign"
  // action below) — a bare unsigned PDF isn't a real legal document.
  await supabaseAdmin
    .from("recurring_charges")
    .update({ active: false })
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .eq("charge_type", "Rent-to-Own Principal")
    .eq("active", true);

  await supabaseAdmin
    .from("rent_to_own_plans")
    .update({ status: "pending_signatures" })
    .eq("id", plan.id);

  const { data: resident } = await supabaseAdmin
    .from("resident_accounts")
    .select("full_name")
    .eq("id", residentId)
    .maybeSingle();

  await supabaseAdmin.from("resident_update_notifications").insert({
    company_id: companyId,
    resident_id: residentId,
    resident_name: resident?.full_name || null,
    update_type: "rent_to_own_paid_off",
    message: `${resident?.full_name || "A resident"} has fully paid off their Rent-to-Own plan — the monthly charge has been stopped. Both parties still need to digitally sign the Bill of Sale before it's finalized (Rent-to-Own Plans → Sign Bill of Sale).`,
  });

  return NextResponse.json({ success: true, completed: false, pendingSignatures: true });
}

// POST action "sign" — body: { companyId, residentId, signerType: 'resident'|'admin', signatureName }
// Records one party's digital signature (typed full legal name, same
// convention as the lease application's own signature). Once BOTH
// signatures are present, generates and finalizes the actual Bill of
// Sale PDF (with the park's own editable clauses + a full payment
// history annex) and marks the plan completed.
async function handleSign(body: any) {
  const { companyId, residentId, signerType, signatureName } = body;
  if (!residentId || !signerType || !signatureName?.trim()) {
    return NextResponse.json({ error: "residentId, signerType, and signatureName are required." }, { status: 400 });
  }
  if (signerType !== "resident" && signerType !== "admin") {
    return NextResponse.json({ error: "signerType must be 'resident' or 'admin'." }, { status: 400 });
  }

  const { data: plan } = await supabaseAdmin
    .from("rent_to_own_plans")
    .select("id, total_price, lot_id, starting_paid_amount, resident_signed_at, admin_signed_at")
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .eq("status", "pending_signatures")
    .is("deleted_at", null)
    .maybeSingle();

  if (!plan) {
    return NextResponse.json({ error: "No plan awaiting signatures was found for this resident." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const signatureUpdate =
    signerType === "resident"
      ? { resident_signed_at: now, resident_signature_name: signatureName.trim() }
      : { admin_signed_at: now, admin_signature_name: signatureName.trim() };

  const { data: updatedPlan, error: signError } = await supabaseAdmin
    .from("rent_to_own_plans")
    .update(signatureUpdate)
    .eq("id", plan.id)
    .select("resident_signed_at, resident_signature_name, admin_signed_at, admin_signature_name")
    .single();

  if (signError) return NextResponse.json({ error: signError.message }, { status: 500 });

  const bothSigned = !!updatedPlan.resident_signed_at && !!updatedPlan.admin_signed_at;
  if (!bothSigned) {
    return NextResponse.json({ success: true, completed: false, waitingOn: updatedPlan.resident_signed_at ? "admin" : "resident" });
  }

  const [{ data: resident }, { data: company }, { data: lot }, { data: parkSettings }] = await Promise.all([
    supabaseAdmin.from("resident_accounts").select("full_name, email, phone, rv_make, rv_model, rv_year, rv_length_ft, rv_vin_or_tag").eq("id", residentId).single(),
    supabaseAdmin.from("companies").select("company_name, address, contact_phone, logo_url").eq("id", companyId).single(),
    plan.lot_id
      ? supabaseAdmin.from("rv_lots").select("lot_name, max_length_ft, max_width_ft, amp_service").eq("id", plan.lot_id).single()
      : Promise.resolve({ data: null as any }),
    supabaseAdmin.from("park_settings").select("bill_of_sale_clauses").eq("company_id", companyId).maybeSingle(),
  ]);

  // Payment history annex: the deposit (if any) plus every Paid
  // "Rent-to-Own Principal" invoice item, oldest first, so the buyer and
  // seller both have a real record of exactly how the total was reached.
  const paymentHistory: { date: string; description: string; amount: number }[] = [];
  if (Number(plan.starting_paid_amount) > 0) {
    paymentHistory.push({ date: "—", description: "Deposit (applied toward purchase price)", amount: Number(plan.starting_paid_amount) });
  }
  const { data: paidInvoices } = await supabaseAdmin
    .from("resident_invoices")
    .select("id, created_at")
    .eq("resident_id", residentId)
    .eq("status", "Paid")
    .order("created_at", { ascending: true });
  const invoiceDateMap: Record<string, string> = {};
  (paidInvoices || []).forEach((inv) => (invoiceDateMap[inv.id] = inv.created_at));
  const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
  if (invoiceIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from("resident_invoice_items")
      .select("invoice_id, amount, description")
      .in("invoice_id", invoiceIds)
      .eq("charge_type", "Rent-to-Own Principal")
      .order("created_at", { ascending: true });
    (items || []).forEach((item) => {
      paymentHistory.push({
        date: new Date(invoiceDateMap[item.invoice_id]).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
        description: item.description || "Principal payment",
        amount: Number(item.amount || 0),
      });
    });
  }

  const pdfBlob = await generateBillOfSalePDFBlob({
    companyName: company?.company_name || "",
    companyAddress: company?.address || "",
    companyPhone: company?.contact_phone || null,
    companyLogoUrl: company?.logo_url || null,
    residentName: resident?.full_name || "",
    residentEmail: resident?.email || null,
    residentPhone: resident?.phone || null,
    lotName: (lot as any)?.lot_name || null,
    rvYear: resident?.rv_year || null,
    rvMake: resident?.rv_make || null,
    rvModel: resident?.rv_model || null,
    rvVinOrTag: resident?.rv_vin_or_tag || null,
    rvLengthFt: resident?.rv_length_ft || null,
    ampService: (lot as any)?.amp_service || null,
    totalPrice: Number(plan.total_price),
    clauses: parkSettings?.bill_of_sale_clauses || DEFAULT_BILL_OF_SALE_CLAUSES,
    paymentHistory,
    residentSignatureName: updatedPlan.resident_signature_name || "",
    residentSignedAt: updatedPlan.resident_signed_at || "",
    adminSignatureName: updatedPlan.admin_signature_name || "",
    adminSignedAt: updatedPlan.admin_signed_at || "",
  });

  const fileName = `bill-of-sale-${plan.id}-${Date.now()}.pdf`;
  // Sep 25 (per Mely — full security audit, "no quiero huecos"): switched
  // from the "lease-documents" PUBLIC bucket (a Bill of Sale PDF's URL
  // worked forever for anyone who got hold of it, no login required) to
  // the same private resident-documents bucket used everywhere else in
  // this pass — file_url now stores a path, resolved to a short-lived
  // signed URL only when actually viewed (resident-documents GET above).
  const { error: uploadError } = await supabaseAdmin.storage
    .from("resident-documents")
    .upload(fileName, pdfBlob, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Bill of Sale PDF upload failed:", uploadError.message);
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Sep 18 (per Mely): only one Bill of Sale should ever exist per
  // resident — replace, not accumulate. This only ever runs once per
  // plan in real use (both signatures are only reachable once), but
  // testing/regenerating could otherwise leave stale duplicates behind.
  // Sep 25: also removes the OLD file from storage, not just its row —
  // previously left every prior version orphaned in storage forever.
  const { data: oldBillsOfSale } = await supabaseAdmin
    .from("resident_documents")
    .select("file_url")
    .eq("resident_id", residentId)
    .eq("document_type", "bill_of_sale");
  const oldPaths = (oldBillsOfSale || []).map((d) => d.file_url).filter(Boolean);
  if (oldPaths.length > 0) {
    await supabaseAdmin.storage.from("resident-documents").remove(oldPaths);
  }
  await supabaseAdmin
    .from("resident_documents")
    .delete()
    .eq("resident_id", residentId)
    .eq("document_type", "bill_of_sale");

  await supabaseAdmin.from("resident_documents").insert({
    company_id: companyId,
    resident_id: residentId,
    file_name: "Bill of Sale",
    file_url: fileName,
    document_type: "bill_of_sale",
    // Sep 18 (per Mely — found live: Bill of Sale rows showed "—" for
    // date in Documents while every other document type showed a real
    // one). Explicitly set instead of relying on a DB default that may
    // not exist on this column — Documents' date column reads this
    // field directly for every non-lease document type.
    uploaded_at: new Date().toISOString(),
  });

  await supabaseAdmin.from("rent_to_own_plans").update({ status: "completed" }).eq("id", plan.id);

  // Sep 25 (per Mely — "renting a park unit deberia tambien tener RTO?"):
  // once a Rent-to-Own plan is fully paid off and both parties have
  // signed, the resident now legally owns their unit — Unit Ownership
  // should flip from "park" (renting) to "resident" (owned) so a later
  // move-out is correctly treated as "still owns the unit, rent
  // continues until sold/removed" instead of ending rent like a regular
  // renter leaving. Never overwrites it if the admin had already set
  // "resident" some other way.
  await supabaseAdmin
    .from("resident_accounts")
    .update({ unit_ownership: "resident" })
    .eq("id", residentId)
    .neq("unit_ownership", "resident");

  return NextResponse.json({ success: true, completed: true });
}

const DEFAULT_BILL_OF_SALE_CLAUSES = `GOVERNING LAW: This Bill of Sale shall be governed by and construed in accordance with the laws of the State of Florida.

CONDITION OF SALE: The property described above is sold "as-is" and "where-is," with no warranties, express or implied, as to its condition, fitness for a particular purpose, or merchantability, except as expressly stated herein.

TITLE TRANSFER: Buyer is solely responsible for completing any required title transfer, registration, or related filings with the Florida Department of Highway Safety and Motor Vehicles (or applicable authority). This document does not itself constitute a certificate of title.

ENTIRE AGREEMENT: This Bill of Sale, together with the underlying Rent-to-Own Agreement, constitutes the entire agreement between the parties regarding the sale of the property described above, and supersedes any prior oral or written agreements relating to that sale.

DISPUTE RESOLUTION: Any dispute arising from this Bill of Sale shall first be addressed through good-faith negotiation between the parties before pursuing formal legal action.`;

async function generateBillOfSalePDFBlob(params: {
  companyName: string;
  companyAddress: string;
  companyPhone: string | null;
  companyLogoUrl: string | null;
  residentName: string;
  residentEmail: string | null;
  residentPhone: string | null;
  lotName: string | null;
  rvYear: string | null;
  rvMake: string | null;
  rvModel: string | null;
  rvVinOrTag: string | null;
  rvLengthFt: number | null;
  ampService: string | null;
  totalPrice: number;
  clauses: string;
  paymentHistory: { date: string; description: string; amount: number }[];
  residentSignatureName: string;
  residentSignedAt: string;
  adminSignatureName: string;
  adminSignedAt: string;
}): Promise<Blob> {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 54;
  const pageWidth = 612;
  const contentWidth = pageWidth - marginX * 2;
  let y = 50;

  const paragraph = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 10.5);
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, marginX, y);
    y += lines.length * 14 + 8;
  };

  const line = () => {
    doc.setDrawColor(200);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 16;
  };

  // Header: logo + park name/address/phone
  let logoDataUrl: string | null = null;
  if (params.companyLogoUrl) {
    try {
      const res = await fetch(params.companyLogoUrl);
      const arrayBuffer = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "image/png";
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      logoDataUrl = `data:${contentType};base64,${base64}`;
    } catch {
      logoDataUrl = null;
    }
  }

  let headerTextY = y;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", marginX, y - 10, 50, 50);
      headerTextY = y + 5;
    } catch {
      // skip broken image formats silently
    }
  }
  const textStartX = logoDataUrl ? marginX + 62 : marginX;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(params.companyName, textStartX, headerTextY);
  headerTextY += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(params.companyAddress, textStartX, headerTextY);
  if (params.companyPhone) {
    headerTextY += 12;
    doc.text(params.companyPhone, textStartX, headerTextY);
  }
  y += 65;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("BILL OF SALE", pageWidth / 2, y, { align: "center" });
  y += 22;

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(`Date: ${today}`, pageWidth / 2, y, { align: "center" });
  y += 24;
  line();

  paragraph("SELLER", { bold: true, size: 10 });
  paragraph(params.companyName);
  paragraph(params.companyAddress);
  if (params.companyPhone) paragraph(params.companyPhone);
  y += 6;

  paragraph("BUYER", { bold: true, size: 10 });
  paragraph(params.residentName);
  if (params.residentEmail) paragraph(params.residentEmail);
  if (params.residentPhone) paragraph(params.residentPhone);
  y += 6;
  line();

  paragraph("PROPERTY DESCRIPTION", { bold: true, size: 10 });
  // Sep 18 (per Mely — found live: "Unit / Lot: A22 / Dimensions: 38 ft
  // (L) / Location: [park address]" read like a real-estate deed for the
  // LOT itself — but a Rent-to-Own sale here is only ever for the
  // RV/park model structure, never the underlying land. Shows the
  // unit's own Year/Make/Model/VIN (what's actually being sold) instead
  // of the lot's max dimensions, and an explicit disclaiming clause
  // right below makes this unambiguous even to someone skimming.
  const descriptionParts = [
    params.rvYear || params.rvMake || params.rvModel ? `${params.rvYear || ""} ${params.rvMake || ""} ${params.rvModel || ""}`.trim() : null,
  ].filter(Boolean);
  paragraph(`Unit: ${descriptionParts.join(" ") || "N/A"}`);
  if (params.rvVinOrTag) paragraph(`VIN / Tag #: ${params.rvVinOrTag}`);
  if (params.rvLengthFt) paragraph(`Length: ${params.rvLengthFt} ft`);
  if (params.ampService) paragraph(`Electrical Service: ${params.ampService}`);
  paragraph(`Situated at: Lot ${params.lotName || "N/A"}, ${params.companyAddress}`);
  y += 4;
  paragraph(
    `This Bill of Sale conveys ownership of the unit described above ONLY. It does NOT include, transfer, or convey any ownership, leasehold, or other interest in the underlying lot or land on which the unit is situated. That land remains the property of ${params.companyName} and continues to be leased separately by Buyer under Buyer's own Lot Lease Agreement.`,
    { bold: true, size: 9 }
  );
  y += 6;
  line();

  paragraph("TRANSFER OF OWNERSHIP", { bold: true, size: 10 });
  paragraph(
    `For and in consideration of the total sum of $${Number(params.totalPrice).toLocaleString()} (${numberToWords(
      Number(params.totalPrice)
    )} dollars), receipt of which is hereby acknowledged in full by Seller, Seller does hereby sell, transfer, and convey to Buyer all right, title, and interest in and to the unit described above, free and clear of all liens and encumbrances, effective as of the date set forth above.`
  );
  paragraph(
    "Seller warrants that it has good and marketable title to the above-described property and full authority to sell the same, and that the property is being sold in its present \"as-is\" condition."
  );
  y += 6;
  line();

  paragraph("PAYMENT HISTORY", { bold: true, size: 10 });
  if (params.paymentHistory.length > 0) {
    params.paymentHistory.forEach((p) => {
      paragraph(`${p.date}  —  ${p.description}  —  $${Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, { size: 9 });
    });
  } else {
    paragraph("No payment history on file.", { size: 9 });
  }
  y += 6;
  line();

  paragraph("TERMS AND CONDITIONS", { bold: true, size: 10 });
  paragraph(params.clauses, { size: 9 });
  y += 14;

  if (y > 620) {
    doc.addPage();
    y = 50;
  }

  if (y > 620) {
    doc.addPage();
    y = 50;
  }

  // Sep 16 (per Mely — found live: signatures printed as plain text
  // below a blank line instead of ON it, unlike the real lease
  // agreement's own signature block). Matches that same pattern:
  // cursive name drawn just above the rule, not underneath it.
  const signatureLine = (name: string, label: string, signedAt: string) => {
    doc.setFont("times", "italic");
    doc.setFontSize(14);
    doc.text(name || "", marginX, y);
    y += 4;
    doc.setDrawColor(0);
    doc.line(marginX, y, marginX + 220, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(label, marginX, y);
    y += 14;
    doc.text(`Signed: ${signedAt ? new Date(signedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) : "—"}`, marginX, y);
  };

  signatureLine(params.adminSignatureName, `${params.companyName} — Authorized Signature`, params.adminSignedAt);
  y += 30;
  signatureLine(params.residentSignatureName, `${params.residentName} — Buyer Signature`, params.residentSignedAt);

  return doc.output("blob");
}

// Small English number-to-words helper — good enough for typical purchase
// price ranges on a legal document; falls back to the numeral for anything
// unusually large it doesn't cover.
function numberToWords(num: number): string {
  const ones = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
  ];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + chunk(n % 100) : "");
  }

  const n = Math.round(num);
  if (n === 0) return "zero";
  if (n >= 1_000_000) return String(n); // fallback for very large amounts

  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  let result = "";
  if (thousands) result += chunk(thousands) + " thousand";
  if (rest) result += (result ? " " : "") + chunk(rest);
  return result.trim();
}
