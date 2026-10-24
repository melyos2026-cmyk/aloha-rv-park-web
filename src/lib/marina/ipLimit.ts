import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 24 (security run): per-device (IP) limits for the public marina forms, under each marina's
// overall cap, so one person can't flood a form and lock real customers out.
// Counted in the database (scripts/security_72_rate_limits.sql) so the limit holds across every
// server instance. The IP itself is never stored, only a salted hash, and rows expire after a day.
// If the table isn't there yet, falls back to a per-instance memory counter.
const mem = new Map<string, { n: number; at: number }>();
const SALT = process.env.MARINA_SESSION_SECRET || process.env.PORTAL_SESSION_SECRET || "melyos-rate";

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function tooManyFromIp(req: Request, scope: string, maxPerHour: number): Promise<boolean> {
  const key = crypto.createHmac("sha256", SALT).update(`${scope}|${clientIp(req)}`).digest("hex").slice(0, 40);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await supabaseAdmin.from("marina_rate_hits").select("id", { count: "exact", head: true }).eq("key", key).gte("at", hourAgo);
  if (error) {
    const now = Date.now(), h = mem.get(key);
    if (!h || now - h.at > 3600_000) { mem.set(key, { n: 1, at: now }); return false; }
    h.n++; return h.n > maxPerHour;
  }
  if ((count || 0) >= maxPerHour) return true;
  await supabaseAdmin.from("marina_rate_hits").insert({ key }).then(() => null, () => null);
  if (Math.random() < 0.02) await supabaseAdmin.from("marina_rate_hits").delete().lt("at", new Date(Date.now() - 86400_000).toISOString()).then(() => null, () => null);
  return false;
}
