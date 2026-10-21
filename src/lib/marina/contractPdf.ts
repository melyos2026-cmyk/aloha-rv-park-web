import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Oct 21 (per Mely): the signed contract PDF — the exact text the boater signed,
// followed by a signature page (who, when, IP, device, document fingerprint).

export type SignedContractInfo = {
  marinaName: string;
  marinaAddress: string;
  domain: string;
  contractId: string;
  title: string;
  body: string;
  bodyHash: string;
  signerName: string;
  signerEmail: string;
  signedAt: Date;
  ip: string;
  userAgent: string;
  signatureImage?: string | null; // PNG data URL
  sentAt?: string | null;
  viewedAt?: string | null;
};

// Standard PDF fonts only know Western characters; anything else becomes "?".
function clean(s: string): string {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/\t/g, "    ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/ +/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) { line = test; continue; }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        out.push(w.slice(0, i)); w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const fmtET = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

export async function buildSignedContractPdf(info: SignedContractInfo): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(info.title));
  pdf.setAuthor(clean(info.marinaName));
  pdf.setSubject("Electronically signed contract");
  pdf.setProducer("MelyOS");
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.06, 0.15, 0.25), gray = rgb(0.4, 0.45, 0.5), gold = rgb(0.69, 0.55, 0.34);
  const W = 612, H = 792, M = 64, width = W - M * 2;
  let page: PDFPage, y = 0, pageNo = 0;

  const newPage = () => {
    page = pdf.addPage([W, H]); pageNo++;
    page.drawText(clean(info.marinaName), { x: M, y: H - 46, size: 12, font: bold, color: ink });
    if (info.marinaAddress) page.drawText(clean(info.marinaAddress), { x: M, y: H - 60, size: 8.5, font: sans, color: gray });
    page.drawRectangle({ x: M, y: H - 70, width, height: 1.5, color: gold });
    page.drawText(`Contract ${info.contractId.slice(0, 8).toUpperCase()} · page ${pageNo}`, { x: M, y: 30, size: 8, font: sans, color: gray });
    page.drawText(`Signed electronically by ${clean(info.signerName)}`, { x: W - M - sans.widthOfTextAtSize(`Signed electronically by ${clean(info.signerName)}`, 8), y: 30, size: 8, font: sans, color: gray });
    y = H - 96;
  };
  const line = (t: string, f: PDFFont, size: number, gap = 4, color = ink) => {
    if (y < 60 + size) newPage();
    page.drawText(t, { x: M, y, size, font: f, color }); y -= size + gap;
  };

  newPage();
  for (const l of wrap(info.title, bold, 15, width)) line(l, bold, 15, 6);
  y -= 6;
  for (const l of wrap(info.body, font, 11, width)) {
    if (!l) { y -= 7; continue; }
    line(l, font, 11, 4.5);
  }

  // Signature page.
  newPage();
  line("Electronic signature record", bold, 16, 12);
  const rows: [string, string][] = [
    ["Signed by", info.signerName],
    ["Email", info.signerEmail || "-"],
    ["Date and time", fmtET(info.signedAt)],
    ["UTC", info.signedAt.toISOString()],
    ["IP address", info.ip || "-"],
    ["Device / browser", info.userAgent || "-"],
    ["Contract sent", info.sentAt ? fmtET(new Date(info.sentAt)) : "-"],
    ["Contract opened", info.viewedAt ? fmtET(new Date(info.viewedAt)) : "-"],
    ["Contract ID", info.contractId],
    ["Document fingerprint (SHA-256)", info.bodyHash],
    ["Signed at", `https://${info.domain}/marina/account`],
  ];
  for (const [k, v] of rows) {
    line(k, bold, 9.5, 2, gray);
    for (const l of wrap(v, sans, 10, width)) line(l, sans, 10, 3);
    y -= 5;
  }
  y -= 6;
  line("Signature", bold, 9.5, 6, gray);
  if (info.signatureImage && /^data:image\/png;base64,/.test(info.signatureImage)) {
    try {
      const img = await pdf.embedPng(Buffer.from(info.signatureImage.split(",")[1], "base64"));
      const scale = Math.min(260 / img.width, 90 / img.height, 1);
      if (y < 60 + img.height * scale) newPage();
      page!.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
      y -= img.height * scale + 6;
    } catch { /* drawn signature is optional */ }
  }
  page!.drawRectangle({ x: M, y: y - 2, width: 260, height: 0.8, color: ink });
  y -= 14;
  line(`/s/ ${clean(info.signerName)}`, font, 14, 14);
  for (const l of wrap(
    `${info.signerName} typed their full name and checked "I agree to sign electronically" to sign this contract. Under the U.S. ESIGN Act and the Florida Uniform Electronic Transaction Act, this electronic signature has the same legal effect as a handwritten signature. The document fingerprint above changes if a single character of the contract text is changed.`,
    sans, 9, width,
  )) line(l, sans, 9, 3, gray);

  return pdf.save();
}
