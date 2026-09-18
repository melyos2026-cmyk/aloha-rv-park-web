import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

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
  // Sep 18 (per Mely — same fix as melyos-builder's copy): shows the
  // unit's own Year/Make/Model/VIN instead of the lot's dimensions, plus
  // an explicit clause that the land itself isn't included in the sale.
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

  // Sep 16 (per Mely — same fix as melyos-builder's copy): cursive name
  // drawn ON the line, matching the lease agreement's own signature
  // style, instead of plain text printed below a blank line.
  const signatureLine = (name: string, label: string, signedAt: string) => {
    doc.setFont("times", "italic");
    doc.setFontSize(20);
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

/**
 * Call this any time a resident's invoice gets marked Paid. If it pushes an
 * active Rent-to-Own plan's paid_so_far to or past total_price, this
 * deactivates the recurring $/mo charge immediately (the money stops no
 * matter what happens with signatures) and moves the plan to
 * "pending_signatures" — the actual Bill of Sale only generates once BOTH
 * the resident and the park have digitally signed (see
 * signBillOfSaleAsResident below). Safe to call unconditionally.
 *
 * Duplicated (not shared) from melyos-builder/app/api/admin/rent-to-own-plans's
 * handleCompleteCheck — these are separate codebases with no shared package.
 * Keep both in sync if this logic changes.
 */
export async function checkAndCompleteRentToOwnPlan(
  residentId: string,
  companyId: string
): Promise<void> {
  const { data: plan } = await supabase
    .from("rent_to_own_plans")
    .select("id, total_price, lot_id, starting_paid_amount, status")
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .in("status", ["active", "pending_signatures"])
    .is("deleted_at", null)
    .maybeSingle();

  if (!plan || plan.status === "pending_signatures") return;

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

  await supabase
    .from("recurring_charges")
    .update({ active: false })
    .eq("resident_id", residentId)
    .eq("charge_type", "Rent-to-Own Principal")
    .eq("active", true);

  await supabase.from("rent_to_own_plans").update({ status: "pending_signatures" }).eq("id", plan.id);

  const { data: resident } = await supabase.from("resident_accounts").select("full_name").eq("id", residentId).maybeSingle();

  await supabase.from("resident_update_notifications").insert({
    company_id: companyId,
    resident_id: residentId,
    resident_name: resident?.full_name || null,
    update_type: "rent_to_own_paid_off",
    message: `${resident?.full_name || "A resident"} has fully paid off their Rent-to-Own plan — the monthly charge has been stopped. Both parties still need to digitally sign the Bill of Sale before it's finalized.`,
  });
}

/**
 * Resident's own signature on the Bill of Sale (called from the resident
 * portal once their plan shows "pending_signatures"). If the park/admin
 * has already signed too, generates and finalizes the actual PDF.
 */
export async function signBillOfSaleAsResident(
  residentId: string,
  companyId: string,
  signatureName: string
): Promise<{ completed: boolean; error?: string }> {
  if (!signatureName?.trim()) return { completed: false, error: "A signature name is required." };

  const { data: plan } = await supabase
    .from("rent_to_own_plans")
    .select("id, total_price, lot_id, starting_paid_amount, admin_signed_at")
    .eq("resident_id", residentId)
    .eq("company_id", companyId)
    .eq("status", "pending_signatures")
    .is("deleted_at", null)
    .maybeSingle();

  if (!plan) return { completed: false, error: "No plan awaiting your signature was found." };

  const now = new Date().toISOString();
  const { data: updatedPlan, error: signError } = await supabase
    .from("rent_to_own_plans")
    .update({ resident_signed_at: now, resident_signature_name: signatureName.trim() })
    .eq("id", plan.id)
    .select("resident_signed_at, resident_signature_name, admin_signed_at, admin_signature_name")
    .single();

  if (signError) return { completed: false, error: signError.message };

  const bothSigned = !!updatedPlan.resident_signed_at && !!updatedPlan.admin_signed_at;
  if (!bothSigned) return { completed: false };

  const [{ data: resident }, { data: company }, { data: lot }, { data: parkSettings }] = await Promise.all([
    supabase.from("resident_accounts").select("full_name, email, phone, rv_make, rv_model, rv_year, rv_length_ft, rv_vin_or_tag").eq("id", residentId).single(),
    supabase.from("companies").select("company_name, address, contact_phone, logo_url").eq("id", companyId).single(),
    plan.lot_id
      ? supabase.from("rv_lots").select("lot_name, max_length_ft, max_width_ft, amp_service").eq("id", plan.lot_id).single()
      : Promise.resolve({ data: null as any }),
    supabase.from("park_settings").select("bill_of_sale_clauses").eq("company_id", companyId).maybeSingle(),
  ]);

  const paymentHistory: { date: string; description: string; amount: number }[] = [];
  if (Number(plan.starting_paid_amount) > 0) {
    paymentHistory.push({ date: "—", description: "Deposit (applied toward purchase price)", amount: Number(plan.starting_paid_amount) });
  }
  const { data: paidInvoices } = await supabase
    .from("resident_invoices")
    .select("id, created_at")
    .eq("resident_id", residentId)
    .eq("status", "Paid")
    .order("created_at", { ascending: true });
  const invoiceDateMap: Record<string, string> = {};
  (paidInvoices || []).forEach((inv) => (invoiceDateMap[inv.id] = inv.created_at));
  const invoiceIds = (paidInvoices || []).map((inv) => inv.id);
  if (invoiceIds.length > 0) {
    const { data: items } = await supabase
      .from("resident_invoice_items")
      .select("invoice_id, amount, description")
      .in("invoice_id", invoiceIds)
      .eq("charge_type", "Rent-to-Own Principal")
      .order("created_at", { ascending: true });
    (items || []).forEach((item: any) => {
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
  const { error: uploadError } = await supabase.storage
    .from("lease-documents")
    .upload(fileName, pdfBlob, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Bill of Sale PDF upload failed:", uploadError.message);
    return { completed: false, error: uploadError.message };
  }

  const { data: publicUrlData } = supabase.storage.from("lease-documents").getPublicUrl(fileName);

  // Sep 18 (per Mely — same fix as melyos-builder's copy): only one Bill
  // of Sale should ever exist per resident — replace, not accumulate.
  await supabase
    .from("resident_documents")
    .delete()
    .eq("resident_id", residentId)
    .eq("document_type", "bill_of_sale");

  await supabase.from("resident_documents").insert({
    company_id: companyId,
    resident_id: residentId,
    file_name: "Bill of Sale",
    file_url: publicUrlData.publicUrl,
    document_type: "bill_of_sale",
    // Sep 18 (per Mely — same fix as melyos-builder's copy): explicit
    // created_at instead of relying on a possibly-absent DB default.
    uploaded_at: new Date().toISOString(),
  });

  await supabase.from("rent_to_own_plans").update({ status: "completed" }).eq("id", plan.id);

  return { completed: true };
}
