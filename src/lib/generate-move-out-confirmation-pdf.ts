import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function generateMoveOutConfirmationPdf(params: {
  companyName: string;
  companyAddress: string | null;
  residentName: string;
  lotName: string | null;
  moveOutDate: string;
  goodStanding: boolean;
  owingAmount: number;
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 54;
  const gray = rgb(0.45, 0.45, 0.45);
  const black = rgb(0.13, 0.13, 0.13);
  const green = rgb(0.09, 0.55, 0.2);
  const red = rgb(0.75, 0.15, 0.15);

  let y = 792 - 60;

  page.drawText(params.companyName, { x: marginX, y, size: 20, font: fontBold, color: black });
  y -= 22;

  if (params.companyAddress) {
    page.drawText(params.companyAddress, { x: marginX, y, size: 10, font, color: gray });
    y -= 26;
  } else {
    y -= 12;
  }

  page.drawText("MOVE-OUT CONFIRMATION", { x: marginX, y, size: 20, font: fontBold, color: black });
  y -= 34;

  const row = (label: string, value: string) => {
    page.drawText(label, { x: marginX, y, size: 11, font, color: gray });
    page.drawText(value, { x: 200, y, size: 11, font: fontBold, color: black });
    y -= 20;
  };

  row("Resident:", params.residentName);
  row("Lot:", params.lotName || "—");
  row("Confirmed Move-Out Date:", new Date(params.moveOutDate + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }));
  row("Statement Date:", new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));

  y -= 16;
  page.drawLine({ start: { x: marginX, y }, end: { x: 558, y }, thickness: 1, color: rgb(0.85, 0.85, 0.85) });
  y -= 30;

  if (params.goodStanding) {
    page.drawText("Account Status: GOOD STANDING", { x: marginX, y, size: 13, font: fontBold, color: green });
    y -= 20;
    page.drawText("No outstanding balance on file as of this statement date.", {
      x: marginX,
      y,
      size: 11,
      font,
      color: gray,
    });
  } else {
    page.drawText("Account Status: BALANCE OWED", { x: marginX, y, size: 13, font: fontBold, color: red });
    y -= 20;
    page.drawText(
      `An outstanding balance of $${params.owingAmount.toFixed(2)} must be paid in full before move-out.`,
      { x: marginX, y, size: 11, font, color: gray }
    );
  }

  y -= 40;
  page.drawText(
    "This confirms the office has received and approved the move-out date above. If your plans",
    { x: marginX, y, size: 10, font, color: gray }
  );
  y -= 14;
  page.drawText(
    "change, you can cancel and resubmit a new date any time from your resident portal.",
    { x: marginX, y, size: 10, font, color: gray }
  );

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
