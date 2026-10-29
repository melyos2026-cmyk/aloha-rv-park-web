import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 29 (security review): every resident file (leases, bills of sale, move-out statements,
// uploads) is opened through a short-lived signed link created server-side. Rows normally hold a
// storage PATH in the private "resident-documents" bucket. Rows written before Sep 25 may still hold
// a full public URL into the old "lease-documents" bucket (now private) — the path is parsed out
// of those so the same signed-link flow keeps working. Only our own project's storage URLs, and only
// these buckets, are accepted; nothing else is ever fetched. Server-only.

export const DEFAULT_FILE_BUCKET = "resident-documents";
const LEGACY_BUCKETS = new Set(["lease-documents", "resident-documents", "maintenance-photos"]);

export type StoredFileRef = { bucket: string; path: string; legacyUrl: boolean };

export function storedFileRef(value: string | null | undefined, defaultBucket = DEFAULT_FILE_BUCKET): StoredFileRef | null {
  let raw = String(value || "").trim();
  if (!raw) return null;
  let bucket = defaultBucket;
  let legacyUrl = false;
  if (/^https?:\/\//i.test(raw)) {
    let u: URL, own: URL;
    try { u = new URL(raw); own = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || ""); } catch { return null; }
    if (u.host !== own.host) return null;
    const m = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (!m) return null;
    try { bucket = decodeURIComponent(m[1]); raw = decodeURIComponent(m[2]); } catch { return null; }
    if (!LEGACY_BUCKETS.has(bucket)) return null;
    legacyUrl = true;
  }
  if (!raw || raw.includes("..") || raw.startsWith("/") || raw.includes("\\")) return null;
  return { bucket, path: raw, legacyUrl };
}

/** A fresh signed link (default 5 minutes) for a stored path or legacy URL, or null. */
export async function signStoredFile(value: string | null | undefined, ttlSeconds = 300, defaultBucket = DEFAULT_FILE_BUCKET): Promise<string | null> {
  const ref = storedFileRef(value, defaultBucket);
  if (!ref) return null;
  const { data } = await supabaseAdmin.storage.from(ref.bucket).createSignedUrl(ref.path, ttlSeconds);
  return data?.signedUrl || null;
}

/** Removes stored files (paths or legacy URLs), grouped per bucket. Never throws. */
export async function removeStoredFiles(values: (string | null | undefined)[], defaultBucket = DEFAULT_FILE_BUCKET) {
  const byBucket = new Map<string, string[]>();
  for (const v of values) {
    const ref = storedFileRef(v, defaultBucket);
    if (!ref) continue;
    byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) || []), ref.path]);
  }
  for (const [bucket, paths] of byBucket) {
    await supabaseAdmin.storage.from(bucket).remove(paths).then(() => {}, () => {});
  }
}
