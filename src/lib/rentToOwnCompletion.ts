import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

function generateBillOfSalePDFBlob(params: {
  companyName: string;
  companyAddress: string;
  residentName: string;
  lotName: string | null;
  totalPrice: number;
}): Blob {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 54;
  const pageWidth = 612;
  const contentWidth = pageWidth - marginX * 2;
  let y = 60;

  const paragraph = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 10.5);
    const lines = doc.splitTextToSize(text, contentWidth);
    doc.text(lines, marginX, y);
    y += lines.length * 14 + 8;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("BILL OF SALE", pageWidth / 2, y, { align: "center" });
  y += 28;

  paragraph(params.companyName, { bold: true, size: 11 });
  paragraph(params.companyAddress);
  y += 10;

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  paragraph(
    `This confirms that, as of ${today}, ${params.residentName} has completed all payments under the Rent-to-Own agreement for the unit located at${params.lotName ? ` Lot ${params.lotName}` : " the agreed lot"}, ${params.companyName}, and full ownership of said unit is hereby transferred to ${params.residentName}.`
  );

  y += 6;
  paragraph(`Total purchase price paid in full: $${Number(params.totalPrice).toLocaleString()}`, { bold: true });

  y += 30;
  paragraph("_____________________________________", {});
  paragraph(`${params.companyName} — Authorized Signature`, {});
  y += 20;
  paragraph("_____________________________________", {});
  paragraph("Date", {});

  return doc.output("blob");
}

/**
 * Call this any time a resident's invoice gets marked Paid. If it pushes an
 * active Rent-to-Own plan's paid_so_far to or past total_price, this
 * generates a Bill of Sale PDF, adds it to the resident's Documents section,
 * and marks the plan completed. Safe to call unconditionally.
 *
 * Duplicated (not shared) from melyos-builder/services/rentToOwn.ts's
 * checkAndCompleteRentToOwnPlan — these are separate codebases with no
 * shared package. Keep both in sync if this logic changes.
 */
export async function checkAndCompleteRentToOwnPlan(
  residentId: string,
  companyId: string
): Promise<void> {
  const { data: plan } = await supabase
    .from("rent_to_own_plans")
    .select("id, total_price, lot_id, starting_paid_amount")
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (!plan) return;

  const { data: paidInvoices } = await supabase
    .from("resident_invoices")
    .select("id")
    .eq("resident_id", residentId)
    .eq("status", "Paid");

  let paidSoFar = Number(plan.starting_paid_amount || 0);
  const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
  if (invoiceIds.length > 0) {
    const { data: items } = await supabase
      .from("resident_invoice_items")
      .select("amount")
      .in("invoice_id", invoiceIds)
      .eq("charge_type", "Rent-to-Own Principal");
    paidSoFar += (items || []).reduce((sum, i) => sum + Number(i.amount || 0), 0);
  }

  if (paidSoFar < Number(plan.total_price)) return; // not paid off yet

  const [{ data: resident }, { data: company }, { data: lot }] = await Promise.all([
    supabase.from("resident_accounts").select("full_name").eq("id", residentId).single(),
    supabase.from("companies").select("company_name, address").eq("id", companyId).single(),
    plan.lot_id
      ? supabase.from("rv_lots").select("lot_name").eq("id", plan.lot_id).single()
      : Promise.resolve({ data: null }),
  ]);

  const pdfBlob = generateBillOfSalePDFBlob({
    companyName: company?.company_name || "",
    companyAddress: company?.address || "",
    residentName: resident?.full_name || "",
    lotName: lot?.lot_name || null,
    totalPrice: Number(plan.total_price),
  });

  const fileName = `bill-of-sale-${plan.id}-${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("lease-documents")
    .upload(fileName, pdfBlob, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Bill of Sale PDF upload failed:", uploadError.message);
    return;
  }

  const { data: publicUrlData } = supabase.storage.from("lease-documents").getPublicUrl(fileName);

  await supabase.from("resident_documents").insert({
    company_id: companyId,
    resident_id: residentId,
    file_name: "Bill of Sale",
    file_url: publicUrlData.publicUrl,
    document_type: "bill_of_sale",
  });

  await supabase.from("rent_to_own_plans").update({ status: "completed" }).eq("id", plan.id);
}
