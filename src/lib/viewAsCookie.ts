// Oct 29 (per Mely — "View as resident"): shared names for the read-only view-as mode. No imports on
// purpose — src/proxy.ts uses this too. See src/lib/residentViewAs.ts for how the mode works.

/** The view-as cookie. Never the resident's own `portal_session` cookie. */
export const VIEW_AS_COOKIE = "resident_view_as";

/** Requests a view-as browser may still make that change nothing (leaving the mode). */
export const VIEW_AS_ALLOWED_WRITES = new Set(["/api/portal/view-as/exit", "/api/portal-logout"]);

export const VIEW_AS_READ_ONLY_MESSAGE =
  "Read only: you are viewing the portal as this resident. Nothing can be paid, signed or changed.";

export const isSafeMethod = (method: string | null | undefined) => {
  const m = String(method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD" || m === "OPTIONS";
};

/** true when the request carries a view-as cookie at all (valid or not). Cheap — no database. */
export function hasViewAsCookie(cookieHeader: string | null | undefined): boolean {
  return String(cookieHeader || "")
    .split(";")
    .some((c) => c.trim().startsWith(`${VIEW_AS_COOKIE}=`));
}
