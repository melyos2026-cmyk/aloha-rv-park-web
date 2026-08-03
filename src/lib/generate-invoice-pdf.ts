import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type InvoiceLineItem = {
  description: string;
  amount: number;
};

// Generates a printable/downloadable PDF for a resident's monthly invoice
// — debits (charges) and credits/refunds are just line items with their
// natural sign, same as the underlying resident_invoice_items table.
export async function generateInvoicePdf(params: {
  companyName: string;
  companyAddress: string | null;
  companyLogoUrl: string | null;
  residentName: string;
  invoiceMonth: string;
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
  const black = rgb(0.07, 0.07, 0.07);
  const green = rgb(0.09, 0.55, 0.2);
  const lineColor = rgb(0.87, 0.87, 0.87);
  let y = 792 - 56;

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
      // no logo — skip silently
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

  page.drawText(`INVOICE — ${params.invoiceMonth}`, { x: marginX, y, size: 20, font: fontBold, color: black });
  y -= 28;

  const metaRow = (label: string, value: string) => {
    page.drawText(label, { x: marginX, y, size: 9, font, color: gray });
    page.drawText(value, { x: marginX + 130, y, size: 9, font: fontBold, color: black });
    y -= 15;
  };

  metaRow("Billed To", params.residentName);
  metaRow(
    "Due Date",
    params.dueDate
      ? new Date(params.dueDate).toLocaleDateString("en-US", { timeZone: "America/New_York" })
      : "N/A"
  );
  metaRow("Status", params.status || "Pending");

  y -= 20;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 22;

  const colDesc = marginX;
  const colAmount = marginX + contentWidth - 60;

  page.drawText("Description", { x: colDesc, y, size: 9, font: fontBold, color: gray });
  page.drawText("Amount", { x: colAmount, y, size: 9, font: fontBold, color: gray });
  y -= 10;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 20;

  for (const item of params.lineItems) {
    const isCredit = item.amount < 0;
    page.drawText(item.description, { x: colDesc, y, size: 10, font, color: black });
    page.drawText(`${isCredit ? "-" : ""}$${Math.abs(item.amount).toFixed(2)}`, {
      x: colAmount,
      y,
      size: 10,
      font,
      color: isCredit ? green : black,
    });
    y -= 20;

    if (y < 100) {
      page.drawText("(additional items omitted — see portal for full detail)", {
        x: colDesc,
        y,
        size: 8,
        font,
        color: lightGray,
      });
      break;
    }
  }

  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: marginX + contentWidth, y }, thickness: 1, color: lineColor });
  y -= 24;

  const isCreditTotal = params.totalAmount < 0;
  page.drawText("Total Due", { x: marginX + contentWidth - 190, y, size: 13, font: fontBold, color: black });
  page.drawText(`${isCreditTotal ? "-" : ""}$${Math.abs(params.totalAmount).toFixed(2)}`, {
    x: colAmount,
    y,
    size: 13,
    font: fontBold,
    color: isCreditTotal ? green : black,
  });

  y -= 30;
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
