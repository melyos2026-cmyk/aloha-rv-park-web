import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

export const PDF_MARGIN_X = 54;
export const PDF_PAGE_WIDTH = 612;
export const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2;

export const pdfColors = {
  gray: rgb(0.45, 0.45, 0.45),
  lightGray: rgb(0.6, 0.6, 0.6),
  black: rgb(0.13, 0.13, 0.13),
  green: rgb(0.09, 0.55, 0.2),
  red: rgb(0.75, 0.15, 0.15),
  lineColor: rgb(0.85, 0.85, 0.85),
};

// Aug 6 (per Mely: "quiero usar ese modelo para todo lo que es pdf de esta
// empresa") — the exact title/logo/company-name/address block from the
// Invoice PDF (Aug 3 design), extracted so every PDF this company sends
// (invoices, move-out confirmations, receipts, etc.) shares the same
// branded look instead of each having its own one-off header.
export async function drawPdfBrandHeader(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  params: {
    title: string;
    companyName: string;
    companyAddress: string | null;
    companyLogoUrl: string | null;
    startY: number;
  }
): Promise<number> {
  let y = params.startY;
  const marginX = PDF_MARGIN_X;

  // Title, top-left, with an underline — matches the Invoice PDF sample.
  page.drawText(params.title, { x: marginX, y, size: 30, font, color: pdfColors.black });
  y -= 8;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + 230, y },
    thickness: 1,
    color: pdfColors.black,
  });
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

  page.drawText(params.companyName, { x: textX, y, size: 15, font: fontBold, color: pdfColors.black });
  y -= 18;
  if (params.companyAddress) {
    const addressLines = params.companyAddress.split(",").map((s) => s.trim());
    for (const line of addressLines) {
      page.drawText(line, { x: textX, y, size: 10, font, color: pdfColors.gray });
      y -= 14;
    }
  }

  return y;
}

export function drawPdfFooter(page: PDFPage, y: number, font: PDFFont, message: string) {
  page.drawText(message, { x: PDF_MARGIN_X, y, size: 9, font, color: pdfColors.lightGray });
}
