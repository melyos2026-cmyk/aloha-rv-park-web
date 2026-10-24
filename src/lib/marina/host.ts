import { headers } from "next/headers";

// Marina sites share this deployment with the RV-park sites and are told
// apart by domain, exactly like the rest of the website: the company whose
// `domain` equals the request host is the one being shown.

export function normalizeHostname(raw: string | null | undefined): string {
  let host = (raw || "").toLowerCase().replace(/^www\./, "").split(":")[0];
  // Local dev and Vercel preview URLs never match a real company domain, so
  // they borrow the one named in NEXT_PUBLIC_DEV_COMPANY_DOMAIN (same rule
  // the browser-side CompanyContext already uses).
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".vercel.app")) {
    host = (process.env.NEXT_PUBLIC_DEV_COMPANY_DOMAIN || host).toLowerCase();
  }
  return host;
}

// For server components and layouts.
export async function getRequestHostname(): Promise<string> {
  const h = await headers();
  return normalizeHostname(h.get("host"));
}

// For route handlers.
export function hostnameFromRequest(req: Request): string {
  return normalizeHostname(req.headers.get("host"));
}

// Demo marinas (marinademo.melyos.io and any future *.melyos.io demo) never
// charge real cards and show the sign-in code on screen instead of emailing.
export function isDemoDomain(domain: string | null | undefined): boolean {
  return !!domain && /(^|\.)melyos\.io$/i.test(domain);
}

// Oct 24 (per Mely — security run before Toho goes live): a marina is a demo when the company is
// marked is_demo OR it lives on a melyos.io address. Fail closed: if either says demo, no card is
// charged. A real marina = is_demo false AND its own domain. Use this everywhere, not the domain alone.
export function isDemoCompany(c: { domain?: string | null; is_demo?: boolean | null } | null | undefined): boolean {
  return !!c && (c.is_demo === true || isDemoDomain(c.domain));
}
