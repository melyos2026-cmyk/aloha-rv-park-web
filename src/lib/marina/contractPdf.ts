import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Oct 21 (per Mely): the signed contract PDF, laid out like a formal legal
// document: centered title, bold numbered sections, justified text, signature
// blocks for the Owner and the Marina, "Page X of Y" on every page, and a final
// electronic signature record (who, when, IP, device, document fingerprint).
// Template formatting: "# " line = title, "## " line = section heading.

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
  signatureStyle?: string | null; // e.g. 'adopted in the "Great Vibes" style' or 'drawn by hand'
  sentAt?: string | null;
  sentByName?: string | null;
  sentBySignature?: string | null; // Oct 27: the marina signer's adopted signature (PNG data URL)
  sentByTitle?: string | null;
  countersignedBy?: string | null; countersignedAt?: string | null; countersignTitle?: string | null; countersignSignature?: string | null; // Oct 27: second marina signature
  viewedAt?: string | null;
};

// Standard PDF fonts only know Western characters; anything else becomes "?".
function clean(s: string): string {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/\t/g, "    ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}

function wrapWords(text: string, font: PDFFont, size: number, width: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const word of clean(text).split(/ +/).filter(Boolean)) {
    const test = [...cur, word].join(" ");
    if (font.widthOfTextAtSize(test, size) <= width || !cur.length) { cur.push(word); continue; }
    lines.push(cur); cur = [word];
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const fmtET = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" });

export async function buildSignedContractPdf(info: SignedContractInfo): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(info.title));
  pdf.setAuthor(clean(info.marinaName));
  pdf.setSubject("Electronically signed contract");
  pdf.setProducer("MelyOS");
  pdf.setCreationDate(info.signedAt);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifB = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifI = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const black = rgb(0.07, 0.07, 0.09), gray = rgb(0.38, 0.4, 0.44);
  const W = 612, H = 792, M = 72, width = W - M * 2; // 1-inch margins, US Letter
  const ref = info.contractId.slice(0, 8).toUpperCase();
  let page!: PDFPage, y = 0;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    page.drawText(clean(info.marinaName), { x: M, y: H - 40, size: 8.5, font: sans, color: gray });
    const r = `Contract No. ${ref}`;
    page.drawText(r, { x: W - M - sans.widthOfTextAtSize(r, 8.5), y: H - 40, size: 8.5, font: sans, color: gray });
    page.drawLine({ start: { x: M, y: H - 46 }, end: { x: W - M, y: H - 46 }, thickness: 0.5, color: gray });
    y = H - M;
  };
  const need = (h: number) => { if (y - h < M) newPage(); };

  // Justified paragraph (last line left-aligned).
  const para = (text: string, font: PDFFont, size: number, lead: number, after: number, indent = 0) => {
    const lines = wrapWords(text, font, size, width - indent);
    lines.forEach((words, i) => {
      need(lead);
      const last = i === lines.length - 1;
      const plain = words.join(" ");
      if (last || words.length === 1) page.drawText(plain, { x: M + indent, y: y - size, size, font, color: black });
      else {
        const wordsW = words.reduce((s, w) => s + font.widthOfTextAtSize(w, size), 0);
        const gap = (width - indent - wordsW) / (words.length - 1);
        let x = M + indent;
        for (const w of words) { page.drawText(w, { x, y: y - size, size, font, color: black }); x += font.widthOfTextAtSize(w, size) + gap; }
      }
      y -= lead;
    });
    y -= after;
  };
  const centered = (text: string, font: PDFFont, size: number, after: number) => {
    for (const words of wrapWords(text, font, size, width)) {
      const t = words.join(" ");
      need(size + 6);
      page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y: y - size, size, font, color: black });
      y -= size + 6;
    }
    y -= after;
  };

  // ── Contract text ──
  newPage();
  const lines = clean(info.body).split("\n").map((l) => l.trimEnd());
  let hasTitle = false;
  for (const l of lines) {
    if (!l.trim()) continue;
    if (l.startsWith("# ")) { centered(l.slice(2).toUpperCase(), serifB, 15, 14); hasTitle = true; continue; }
    if (!hasTitle) { centered(info.title.toUpperCase(), serifB, 15, 14); hasTitle = true; }
    if (l.startsWith("## ")) { need(40); y -= 6; para(l.slice(3).toUpperCase(), serifB, 11.5, 15, 4); continue; }
    para(l, serif, 11.5, 15.5, 7);
  }

  // ── Signature blocks ──
  y -= 14;
  need(190);
  const colW = (width - 36) / 2;
  const block = (x: number, label: string, sigLine: string, lines: string[], image?: string | null) => {
    let yy = y;
    page.drawText(label, { x, y: yy - 10, size: 10, font: serifB, color: black });
    yy -= 58;
    return { x, yy, sigLine, lines, image };
  };
  const owner = block(M, "OWNER", `/s/ ${clean(info.signerName)}`, [clean(info.signerName), `Date: ${fmtDay(info.signedAt)}`], info.signatureImage);
  const sentBy = clean(info.sentByName || "Authorized Representative");
  const marina = block(M + colW + 36, "MARINA", `/s/ ${sentBy}`, [`${clean(info.marinaName)}`, `By: ${sentBy}, ${clean(info.sentByTitle || "") || "Authorized Representative"}`, `Date: ${info.sentAt ? fmtDay(new Date(info.sentAt)) : fmtDay(info.signedAt)}`], info.sentBySignature);
  const draw = async (b: { x: number; yy: number; sigLine: string; lines: string[]; image?: string | null }) => {
    if (b.image && /^data:image\/png;base64,/.test(b.image)) {
      try {
        const img = await pdf.embedPng(Buffer.from(b.image.split(",")[1], "base64"));
        const s = Math.min(colW / img.width, 44 / img.height, 1);
        page.drawImage(img, { x: b.x, y: b.yy + 2, width: img.width * s, height: img.height * s });
      } catch { /* optional */ }
    } else {
      page.drawText(b.sigLine, { x: b.x + 2, y: b.yy + 6, size: 14, font: serifI, color: black });
    }
    page.drawLine({ start: { x: b.x, y: b.yy }, end: { x: b.x + colW, y: b.yy }, thickness: 0.8, color: black });
    let ly = b.yy - 13;
    for (const t of b.lines) { page.drawText(t, { x: b.x, y: ly, size: 9.5, font: serif, color: black }); ly -= 12.5; }
  };
  for (const b of [owner, marina]) await draw(b);
  y -= 120;
  // Oct 27 (per Mely): a second marina signature (e.g. a director), below, on the right
  if (info.countersignedBy) {
    need(110);
    await draw(block(M + colW + 36, "APPROVED FOR THE MARINA", `/s/ ${clean(info.countersignedBy)}`, [`By: ${clean(info.countersignedBy)}, ${clean(info.countersignTitle || "") || "Authorized Representative"}`, `Date: ${info.countersignedAt ? fmtDay(new Date(info.countersignedAt)) : ""}`], info.countersignSignature));
    y -= 110;
  }

  // ── Electronic signature record ──
  newPage();
  centered("CERTIFICATE OF ELECTRONIC SIGNATURE", serifB, 13, 10);
  para(`This certificate is part of Contract No. ${ref} between ${info.marinaName} and ${info.signerName}.`, serif, 10.5, 14, 10);
  const rows: [string, string][] = [
    ["Document", info.title],
    ["Contract ID", info.contractId],
    ["Issued by", `${info.sentByName || "Authorized Representative"} for ${info.marinaName}${info.sentAt ? `, ${fmtET(new Date(info.sentAt))}` : ""}`],
    ...(info.countersignedBy ? [["Approved for the marina by", `${info.countersignedBy}${info.countersignTitle ? `, ${info.countersignTitle}` : ""}${info.countersignedAt ? `, ${fmtET(new Date(info.countersignedAt))}` : ""}`] as [string, string]] : []),
    ["Opened by signer", info.viewedAt ? fmtET(new Date(info.viewedAt)) : "-"],
    ["Signed by", `${info.signerName} (${info.signerEmail || "no email"})`],
    ["Date and time signed", `${fmtET(info.signedAt)}  (UTC ${info.signedAt.toISOString()})`],
    ["Method", `Signer was signed in to their boater account at ${info.domain} with a one-time code sent to their email, typed their full name, and checked "I adopt this signature and agree to sign electronically"${info.signatureImage ? `; signature image ${info.signatureStyle || "captured"}` : ""}.`],
    ["IP address", info.ip || "-"],
    ["Device / browser", info.userAgent || "-"],
    ["Document fingerprint (SHA-256 of the contract text)", info.bodyHash],
  ];
  for (const [k, v] of rows) {
    need(34);
    page.drawText(k.toUpperCase(), { x: M, y: y - 8, size: 7.5, font: sans, color: gray }); y -= 12;
    para(v, sans, 9.5, 12.5, 7);
  }
  y -= 6;
  para(`Under the federal Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001 et seq.) and the Florida Uniform Electronic Transaction Act (§ 668.50, Fla. Stat.), this electronic signature has the same legal effect as a handwritten signature. The document fingerprint above is computed from the exact contract text; any change to a single character produces a different fingerprint.`, serif, 9.5, 12.5, 0);

  // Page X of Y on every page.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawText(t, { x: (W - sans.widthOfTextAtSize(t, 8.5)) / 2, y: 34, size: 8.5, font: sans, color: gray });
    const ini = `Electronically signed by ${clean(info.signerName)}`;
    p.drawText(ini, { x: W - M - sans.widthOfTextAtSize(ini, 7.5), y: 34, size: 7.5, font: sans, color: gray });
  });
  return pdf.save();
}
