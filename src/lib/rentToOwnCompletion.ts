import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

async function generateBillOfSalePDFBlob(params: {
  companyName: string;
  companyAddress: string;
  companyPhone: string | null;
  companyLogoUrl: string | null;
  residentName: string;
  residentEmail: string | null;
  residentPhone: string | null;
  lotName: string | null;
  lotMaxLengthFt: number | null;
  lotMaxWidthFt: number | null;
  ampService: string | null;
  totalPrice: number;
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
      const blob = await res.blob();
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
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

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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
  paragraph(`Unit / Lot: ${params.lotName || "N/A"}`);
  if (params.lotMaxLengthFt || params.lotMaxWidthFt) {
    paragraph(
      `Dimensions: ${params.lotMaxLengthFt ? `${params.lotMaxLengthFt} ft (L)` : ""}${
        params.lotMaxLengthFt && params.lotMaxWidthFt ? " x " : ""
      }${params.lotMaxWidthFt ? `${params.lotMaxWidthFt} ft (W)` : ""}`
    );
  }
  if (params.ampService) paragraph(`Electrical Service: ${params.ampService}`);
  paragraph(`Location: ${params.companyAddress}`);
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
  y += 20;

  paragraph("_____________________________________", {});
  paragraph(`${params.companyName} — Authorized Signature`, {});
  y += 24;
  paragraph("_____________________________________", {});
  paragraph(`${params.residentName} — Buyer Signature`, {});

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
    supabase.from("resident_accounts").select("full_name, email, phone").eq("id", residentId).single(),
    supabase
      .from("companies")
      .select("company_name, address, contact_phone, logo_url")
      .eq("id", companyId)
      .single(),
    plan.lot_id
      ? supabase
          .from("rv_lots")
          .select("lot_name, max_length_ft, max_width_ft, amp_service")
          .eq("id", plan.lot_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const pdfBlob = await generateBillOfSalePDFBlob({
    companyName: company?.company_name || "",
    companyAddress: company?.address || "",
    companyPhone: company?.contact_phone || null,
    companyLogoUrl: company?.logo_url || null,
    residentName: resident?.full_name || "",
    residentEmail: resident?.email || null,
    residentPhone: resident?.phone || null,
    lotName: lot?.lot_name || null,
    lotMaxLengthFt: lot?.max_length_ft || null,
    lotMaxWidthFt: lot?.max_width_ft || null,
    ampService: lot?.amp_service || null,
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
