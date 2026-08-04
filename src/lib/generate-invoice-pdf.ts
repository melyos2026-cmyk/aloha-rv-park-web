import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type InvoiceLineItem = {
  description: string;
  amount: number;
};

// Generates a printable/downloadable PDF for a resident's monthly invoice,
// matching Mely's requested layout (Aug 3): INVOICE title, company
// logo/name/address, ISSUED TO / DATE / DUE DATE, a
// DESCRIPTION/QTY/TOTAL table, SUBTOTAL, and a final total line that reads
// "PAID" (green) if the invoice is already paid, or "TOTAL DUE" otherwise.
// (PAY TO section removed per Mely's request — redundant with the
// company name/address already shown at the top.)
export async function generateInvoicePdf(params: {
  companyName: string;
  companyAddress: string | null;
  companyLogoUrl: string | null;
  residentName: string;
  residentLot: string | null;
  invoiceMonth: string;
  issuedDate: string | null;
  dueDate: string | null;
  status: string | null;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 54;
  const pageWidth = 612;
  const contentWidth = pageWidth - marginX * 2;
  const gray = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.6, 0.6, 0.6);
  const black = rgb(0.13, 0.13, 0.13);
  const green = rgb(0.09, 0.55, 0.2);
  const lineColor = rgb(0.85, 0.85, 0.85);
  const isPaid = (params.status || "").toLowerCase() === "paid";

  let y = 792 - 60;

  // "INVOICE" title, top-left, with an underline — matches the sample.
  page.setFontSize?.(28);
  page.drawText("INVOICE", { x: marginX, y, size: 30, font, color: black });
  y -= 8;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + 230, y }, thickness: 1, color: black });
  y -= 36;

  // Logo (left, next to company name) + company name/address block.
  let textX = marginX;
  if (params.companyLogoUrl) {
    try {
      const res = await fetch(params.companyLogoUrl);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "";
      const image = contentType.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const maxDim = 72;
      const scale = Math.min(maxDim / image.width, maxDim / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: marginX, y: y - h + 14, width: w, height: h });
      textX = marginX + w + 16;
    } catch {
      // no logo — skip silently
    }
  }

  page.drawText(params.companyName, { x: textX, y, size: 15, font: fontBold, color: black });
  y -= 18;
  if (params.companyAddress) {
    const addressLines = params.companyAddress.split(",").map((s) => s.trim());
    for (const line of addressLines) {
      page.drawText(line, { x: textX, y, size: 10, font, color: gray });
      y -= 14;
    }
  }

  y -= 40;

  // ISSUED TO (left) / DATE + DUE DATE (right)
  const rightColX = marginX + contentWidth - 190;
  const issuedToTop = y;

  page.drawText("ISSUED TO:", { x: marginX, y, size: 10, font: fontBold, color: black });
  page.drawText("DATE:", { x: rightColX, y, size: 10, font: fontBold, color: black });
  page.drawText(
    params.issuedDate ? new Date(params.issuedDate).toLocaleDateString("en-US") : "—",
    { x: rightColX + 70, y, size: 10, font, color: black }
  );
  y -= 16;

  page.drawText(params.residentName, { x: marginX, y, size: 10, font, color: black });
  page.drawText("DUE DATE:", { x: rightColX, y, size: 10, font: fontBold, color: black });
  page.drawText(
    params.dueDate ? new Date(params.dueDate).toLocaleDateString("en-US") : "N/A",
    { x: rightColX + 70, y, size: 10, font, color: black }
  );
  y -= 16;

  if (params.residentLot) {
    page.drawText(`Lot ${params.residentLot}`, { x: marginX, y, size: 10, font, color: black });
    y -= 16;
  }

  y = Math.min(y, issuedToTop - 48) - 24;

  // Thick divider bar, matching the sample's bold rule above the table.
  page.drawLine({ start: { x: marginX + contentWidth / 2 - 100, y }, end: { x: marginX + contentWidth / 2 + 100, y }, thickness: 3, color: black });
  y -= 30;

  // Table header: DESCRIPTION | QTY | TOTAL
  const colDesc = marginX;
  const colQty = marginX + contentWidth - 130;
  const colTotal = marginX + contentWidth - 60;
  // SUBTOTAL / TOTAL DUE labels need more room to the left than "QTY" does
  // — otherwise longer text like "TOTAL DUE" runs right into the amount.
  const colSummaryLabel = marginX + contentWidth - 220;

  page.drawText("DESCRIPTION", { x: colDesc, y, size: 10, font: fontBold, color: gray });
  page.drawText("QTY", { x: colQty, y, size: 10, font: fontBold, color: gray });
  page.drawText("TOTAL", { x: colTotal, y, size: 10, font: fontBold, color: gray });
  y -= 8;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 22;

  for (const item of params.lineItems) {
    const isCredit = item.amount < 0;
    page.drawText(item.description, { x: colDesc, y, size: 10, font, color: black });
    page.drawText("1", { x: colQty, y, size: 10, font, color: black });
    page.drawText(`${isCredit ? "-" : ""}$${Math.abs(item.amount).toFixed(2)}`, {
      x: colTotal,
      y,
      size: 10,
      font,
      color: isCredit ? green : black,
    });
    y -= 22;

    if (y < 140) {
      page.drawText("(additional items omitted — see portal for full detail)", {
        x: colDesc,
        y,
        size: 8,
        font,
        color: lightGray,
      });
      y -= 20;
      break;
    }
  }

  y -= 4;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 26;

  const subtotal = params.lineItems.reduce((sum, i) => sum + Number(i.amount || 0), 0);
  page.drawText("SUBTOTAL", { x: colSummaryLabel, y, size: 10, font, color: gray });
  page.drawText(`$${Math.abs(subtotal).toFixed(2)}`, { x: colTotal, y, size: 10, font, color: black });
  y -= 26;

  // Final total line — "PAID" in green if settled, "TOTAL DUE" otherwise.
  const totalLabel = isPaid ? "PAID" : "TOTAL DUE";
  const totalColor = isPaid ? green : black;
  page.drawText(totalLabel, { x: colSummaryLabel, y, size: 14, font: fontBold, color: totalColor });
  page.drawText(`$${Math.abs(params.totalAmount).toFixed(2)}`, {
    x: colTotal,
    y,
    size: 14,
    font: fontBold,
    color: totalColor,
  });

  y -= 40;
  page.drawText("Generated from your resident portal. For questions, contact the park office.", {
    x: marginX,
    y,
    size: 9,
    font,
    color: lightGray,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
