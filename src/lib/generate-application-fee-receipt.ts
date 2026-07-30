import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ReceiptLineItem = {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

// Generates a professional, itemized PDF payment receipt for a lease
// application fee. Uses pdf-lib — zero DOM/canvas dependency, so it's
// reliable in a pure Node serverless function (unlike jsPDF, which is
// built for the browser).
export async function generateApplicationFeeReceiptPdf(params: {
  companyName: string;
  companyAddress: string | null;
  companyLogoUrl: string | null;
  applicantName: string;
  lineItems: ReceiptLineItem[];
  totalPaid: number;
  receiptNumber: string;
  transactionId: string;
  paymentDate: Date;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US Letter, points
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 54;
  const pageWidth = 612;
  const contentWidth = pageWidth - marginX * 2;
  const gray = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.6, 0.6, 0.6);
  const black = rgb(0.07, 0.07, 0.07);
  const lineColor = rgb(0.87, 0.87, 0.87);
  let y = 792 - 56;

  // Logo (top-right) — best-effort; if it fails to fetch/embed, skip
  // silently rather than failing the whole receipt.
  if (params.companyLogoUrl) {
    try {
      const res = await fetch(params.companyLogoUrl);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "";
      const image = contentType.includes("png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const maxDim = 56;
      const scale = Math.min(maxDim / image.width, maxDim / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, {
        x: pageWidth - marginX - w,
        y: 792 - 56 - h + 12,
        width: w,
        height: h,
      });
    } catch {
      // no logo available — fine, just skip it
    }
  }

  page.drawText(params.companyName, { x: marginX, y, size: 18, font: fontBold, color: black });
  y -= 20;

  if (params.companyAddress) {
    page.drawText(params.companyAddress, { x: marginX, y, size: 10, font, color: gray });
    y -= 30;
  } else {
    y -= 16;
  }

  page.drawText("RECEIPT", { x: marginX, y, size: 22, font: fontBold, color: black });
  y -= 28;

  // Meta info (two columns: labels left, values right-aligned area)
  const metaRow = (label: string, value: string) => {
    page.drawText(label, { x: marginX, y, size: 9, font, color: gray });
    page.drawText(value, { x: marginX + 130, y, size: 9, font: fontBold, color: black });
    y -= 15;
  };

  metaRow("Billed To", params.applicantName);
  metaRow("Receipt #", params.receiptNumber);
  metaRow("Date", params.paymentDate.toLocaleDateString("en-US", { timeZone: "America/New_York" }));
  metaRow("Payment Method", "Credit/Debit Card (Stripe)");
  metaRow("Transaction ID", params.transactionId);

  y -= 20;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 22;

  // Table header
  const colDesc = marginX;
  const colQty = marginX + 300;
  const colUnit = marginX + 360;
  const colAmount = marginX + contentWidth - 60;

  page.drawText("Description", { x: colDesc, y, size: 9, font: fontBold, color: gray });
  page.drawText("Qty", { x: colQty, y, size: 9, font: fontBold, color: gray });
  page.drawText("Unit Price", { x: colUnit, y, size: 9, font: fontBold, color: gray });
  page.drawText("Amount", { x: colAmount, y, size: 9, font: fontBold, color: gray });
  y -= 10;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 20;

  for (const item of params.lineItems) {
    page.drawText(item.description, { x: colDesc, y, size: 10, font, color: black });
    page.drawText(String(item.qty), { x: colQty, y, size: 10, font, color: black });
    page.drawText(`$${item.unitPrice.toFixed(2)}`, { x: colUnit, y, size: 10, font, color: black });
    page.drawText(`$${item.amount.toFixed(2)}`, { x: colAmount, y, size: 10, font, color: black });
    y -= 20;
  }

  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 24;

  const totalRow = (label: string, value: string, opts: { big?: boolean } = {}) => {
    const size = opts.big ? 13 : 10;
    page.drawText(label, { x: colUnit - 30, y, size, font: fontBold, color: black });
    page.drawText(value, { x: colAmount, y, size, font: fontBold, color: black });
    y -= opts.big ? 20 : 16;
  };

  totalRow("Subtotal", `$${params.totalPaid.toFixed(2)}`);
  y -= 4;
  totalRow("Amount Paid", `$${params.totalPaid.toFixed(2)}`, { big: true });

  y -= 24;
  page.drawText("This fee is non-refundable. Thank you for your application.", {
    x: marginX,
    y,
    size: 9,
    font,
    color: lightGray,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
