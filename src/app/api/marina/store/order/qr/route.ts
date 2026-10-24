import QRCode from "qrcode";
import { getMarinaForRequest } from "@/lib/marina/company";
import { loadOrderByLink, orderPageUrl } from "@/lib/marina/storeOrders";

// Oct 24 (per Mely): QR code for a store order (shown on the order page and in the email).
// It holds the order's private link, so the counter can scan it to open the order.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const n = (u.searchParams.get("n") || "").slice(0, 40), t = (u.searchParams.get("t") || "").slice(0, 64);
  const o = n && t ? await loadOrderByLink(company.id, n, t) : null;
  if (!o) return new Response("Not found", { status: 404 });
  const png = await QRCode.toBuffer(orderPageUrl(company.domain, o.order_number, t), { width: 360, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f2540", light: "#ffffff" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
}
