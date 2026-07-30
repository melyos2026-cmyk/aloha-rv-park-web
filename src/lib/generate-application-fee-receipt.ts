// Generates a proper PDF payment receipt for a lease application fee —
// runs server-side (Node/serverless), so it outputs an ArrayBuffer rather
// than a browser Blob like the client-side lease PDF generator does.
export function generateApplicationFeeReceiptPdf(params: {
  companyName: string;
  companyAddress: string | null;
  applicantName: string;
  amountPaid: number;
  description: string;
  receiptNumber: string;
  transactionId: string;
  paymentDate: Date;
}): Buffer {
  const { jsPDF } = require("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 54;
  const pageWidth = 612;
  const contentWidth = pageWidth - marginX * 2;
  let y = 60;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(params.companyName, marginX, y);
  y += 20;

  if (params.companyAddress) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(params.companyAddress, marginX, y);
    y += 24;
  } else {
    y += 10;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 30;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Payment Receipt", marginX, y);
  y += 30;

  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, marginX + 160, y);
    y += 20;
  };

  row("Billed To:", params.applicantName);
  row("Description:", params.description);
  row("Date:", params.paymentDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
  row("Receipt #:", params.receiptNumber);
  row("Transaction ID:", params.transactionId);
  row("Payment Method:", "Credit/Debit Card (Stripe)");

  y += 10;
  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 30;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Amount Paid:", marginX, y);
  doc.setFontSize(16);
  doc.text(`$${params.amountPaid.toFixed(2)}`, marginX + 160, y);
  y += 40;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("This fee is non-refundable. Thank you for your application.", marginX, y);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
