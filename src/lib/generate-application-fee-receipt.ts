import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Generates a proper PDF payment receipt for a lease application fee.
// Uses pdf-lib instead of jsPDF — pdf-lib has zero DOM/canvas dependency,
// so it's reliable in a pure Node serverless function (jsPDF is built for
// the browser and can behave unpredictably server-side).
export async function generateApplicationFeeReceiptPdf(params: {
  companyName: string;
  companyAddress: string | null;
  applicantName: string;
  amountPaid: number;
  description: string;
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
  let y = 792 - 60;
  const gray = rgb(0.47, 0.47, 0.47);
  const black = rgb(0.07, 0.07, 0.07);
  const lineColor = rgb(0.8, 0.8, 0.8);

  page.drawText(params.companyName, { x: marginX, y, size: 16, font: fontBold, color: black });
  y -= 20;

  if (params.companyAddress) {
    page.drawText(params.companyAddress, { x: marginX, y, size: 10, font, color: gray });
    y -= 24;
  } else {
    y -= 10;
  }

  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + contentWidth, y },
    thickness: 1,
    color: lineColor,
  });
  y -= 30;

  page.drawText("Payment Receipt", { x: marginX, y, size: 18, font: fontBold, color: black });
  y -= 30;

  const row = (label: string, value: string) => {
    page.drawText(label, { x: marginX, y, size: 10, font: fontBold, color: black });
    page.drawText(value, { x: marginX + 160, y, size: 10, font, color: black });
    y -= 20;
  };

  row("Billed To:", params.applicantName);
  row("Description:", params.description);
  row("Date:", params.paymentDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
  row("Receipt #:", params.receiptNumber);
  row("Transaction ID:", params.transactionId);
  row("Payment Method:", "Credit/Debit Card (Stripe)");

  y -= 10;
  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + contentWidth, y },
    thickness: 1,
    color: lineColor,
  });
  y -= 30;

  page.drawText("Amount Paid:", { x: marginX, y, size: 14, font: fontBold, color: black });
  page.drawText(`$${params.amountPaid.toFixed(2)}`, {
    x: marginX + 160,
    y,
    size: 16,
    font: fontBold,
    color: black,
  });
  y -= 40;

  page.drawText("This fee is non-refundable. Thank you for your application.", {
    x: marginX,
    y,
    size: 9,
    font,
    color: gray,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
