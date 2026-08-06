import { PDFDocument, StandardFonts } from "pdf-lib";
import { drawPdfBrandHeader, drawPdfFooter, PDF_MARGIN_X, PDF_CONTENT_WIDTH, pdfColors } from "./pdf-brand-template";

export async function generateMoveOutConfirmationPdf(params: {
  companyName: string;
  companyAddress: string | null;
  companyLogoUrl: string | null;
  residentName: string;
  lotName: string | null;
  moveOutDate: string;
  goodStanding: boolean;
  owingAmount: number;
  finalized?: boolean;
  notes?: string | null;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = PDF_MARGIN_X;
  let y = 792 - 60;

  y = await drawPdfBrandHeader(doc, page, font, fontBold, {
    title: params.finalized ? "MOVE-OUT / CANCELLATION STATEMENT" : "MOVE-OUT CONFIRMATION",
    companyName: params.companyName,
    companyAddress: params.companyAddress,
    companyLogoUrl: params.companyLogoUrl,
    startY: y,
  });

  y -= 40;

  page.drawLine({
    start: { x: marginX + PDF_CONTENT_WIDTH / 2 - 100, y },
    end: { x: marginX + PDF_CONTENT_WIDTH / 2 + 100, y },
    thickness: 3,
    color: pdfColors.black,
  });
  y -= 30;

  const row = (label: string, value: string) => {
    page.drawText(label, { x: marginX, y, size: 10, font: fontBold, color: pdfColors.gray });
    page.drawText(value, { x: 200, y, size: 11, font, color: pdfColors.black });
    y -= 20;
  };

  row("RESIDENT:", params.residentName);
  row("LOT:", params.lotName || "—");
  row(
    "MOVE-OUT DATE:",
    new Date(params.moveOutDate + "T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  );
  row(
    "STATEMENT DATE:",
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  );

  y -= 10;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + PDF_CONTENT_WIDTH, y },
    thickness: 1,
    color: pdfColors.lineColor,
  });
  y -= 30;

  if (params.goodStanding) {
    page.drawText("ACCOUNT STATUS: GOOD STANDING", { x: marginX, y, size: 13, font: fontBold, color: pdfColors.green });
    y -= 20;
    page.drawText("No outstanding balance on file as of this statement date.", {
      x: marginX,
      y,
      size: 10,
      font,
      color: pdfColors.gray,
    });
  } else {
    page.drawText("ACCOUNT STATUS: BALANCE OWED", { x: marginX, y, size: 13, font: fontBold, color: pdfColors.red });
    y -= 20;
    page.drawText(
      `An outstanding balance of $${params.owingAmount.toFixed(2)} must be paid in full before move-out.`,
      { x: marginX, y, size: 10, font, color: pdfColors.gray }
    );
    y -= 14;
    page.drawText(
      "If this balance remains unpaid, it may be sent to a collections agency.",
      { x: marginX, y, size: 10, font, color: pdfColors.red }
    );
  }

  y -= 40;
  if (params.finalized) {
    page.drawText(
      "This is the official record of this resident's move-out. The lease has been closed as of the",
      { x: marginX, y, size: 10, font, color: pdfColors.gray }
    );
    y -= 14;
    page.drawText(
      "date above, reflecting the account status shown.",
      { x: marginX, y, size: 10, font, color: pdfColors.gray }
    );
  } else {
    page.drawText(
      "This confirms the office has received and approved the move-out date above. If your plans",
      { x: marginX, y, size: 10, font, color: pdfColors.gray }
    );
    y -= 14;
    page.drawText(
      "change, you can cancel and resubmit a new date any time from your resident portal.",
      { x: marginX, y, size: 10, font, color: pdfColors.gray }
    );
  }

  if (params.notes?.trim()) {
    y -= 24;
    page.drawText("Notes:", { x: marginX, y, size: 10, font: fontBold, color: pdfColors.gray });
    y -= 14;
    page.drawText(params.notes.trim().slice(0, 200), { x: marginX, y, size: 10, font, color: pdfColors.gray });
  }

  y -= 40;
  drawPdfFooter(page, y, font, "Generated from your resident portal. For questions, contact the park office.");

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
