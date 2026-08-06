import { PDFDocument, StandardFonts } from "pdf-lib";
import { drawPdfBrandHeader, drawPdfFooter, PDF_MARGIN_X, PDF_CONTENT_WIDTH, pdfColors } from "./pdf-brand-template";

export type InvoiceLineItem = {
  description: string;
  amount: number;
};

// Generates a printable/downloadable PDF for a resident's monthly invoice,
// matching Mely's requested layout (Aug 3): INVOICE title, company
// logo/name/address, ISSUED TO / DATE / DUE DATE, a
// DESCRIPTION/QTY/TOTAL table, SUBTOTAL, and a final total line that reads
// "PAID" (green) if the invoice is already paid, or "TOTAL DUE" otherwise.
// Aug 6: header/footer now come from the shared pdf-brand-template — this
// is THE reference design every other company PDF (move-out confirmation,
// etc.) is built to match, per Mely's explicit request.
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

  const marginX = PDF_MARGIN_X;
  const contentWidth = PDF_CONTENT_WIDTH;
  const { gray, lightGray, black, green, lineColor } = pdfColors;
  const isPaid = (params.status || "").toLowerCase() === "paid";

  let y = 792 - 60;

  y = await drawPdfBrandHeader(doc, page, font, fontBold, {
    title: "INVOICE",
    companyName: params.companyName,
    companyAddress: params.companyAddress,
    companyLogoUrl: params.companyLogoUrl,
    startY: y,
  });

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
  drawPdfFooter(page, y, font, "Generated from your resident portal. For questions, contact the park office.");

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
