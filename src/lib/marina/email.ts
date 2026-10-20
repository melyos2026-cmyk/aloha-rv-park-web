// Oct 20 (security review): `.ilike("email", email)` treats `%` and `_`
// (and PostgREST's `*`) inside the typed email as WILDCARDS — e.g. "%@%"
// matched the first boater on file and a sign-in code got issued for
// their account. Stored emails can have mixed case (typed by staff), so a
// plain `.eq` on the lowercased value would miss real boaters. Instead:
// escape the LIKE wildcards for the database filter, then confirm an
// exact case-insensitive match in code before trusting any row.

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a ?? "").trim().toLowerCase();
  const y = String(b ?? "").trim().toLowerCase();
  return x.length > 0 && x === y;
}

// True when the email contains a character PostgREST would treat as a
// wildcard even after escaping (`*`). Such addresses are effectively never
// real, so callers just treat them as "not found".
export function hasWildcardChars(value: string): boolean {
  return value.includes("*");
}
