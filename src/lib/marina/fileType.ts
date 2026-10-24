// Oct 24 (security run): tell a file's real type from its first bytes (never trust the browser's
// label or the file name). Only photos and PDFs — no SVG, which can carry scripts.
export function sniff(buf: Buffer, opts: { pdf?: boolean } = { pdf: true }): { ext: string; type: string } | null {
  const h = buf.subarray(0, 16);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (h.subarray(0, 4).toString("latin1") === "RIFF" && h.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  if (h.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|mif1|msf1|hevc)$/.test(h.subarray(8, 12).toString("latin1"))) return { ext: "heic", type: "image/heic" };
  if (opts.pdf !== false && h.subarray(0, 4).toString("latin1") === "%PDF") return { ext: "pdf", type: "application/pdf" };
  return null;
}
