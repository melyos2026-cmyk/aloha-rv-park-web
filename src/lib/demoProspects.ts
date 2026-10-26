import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";


// Oct 26 (per Mely): every visit to the demo is logged — with a personal link (?d=…) under that
// prospect, without one under "Visitor from <city>" (grouped by internet connection). Mely can name
// a visitor or mark one as herself (no more emails). Personal demo links: A prospect opens marinademo.melyos.io/?d=<slug>; the
// website logs each page and the demo office (adminmarinademo.melyos.io/?d=<slug>) logs the entry
// and each screen. Mely gets an email when they arrive (once per visit, 30 minutes apart) and
// when they enter the office. The same logic lives in the builder repo (lib/demoProspects.ts).
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OWNER = process.env.MELYOS_ADMIN_EMAIL || "melyos2026@gmail.com";
const GAP = 30 * 60 * 1000;

export const cleanSlug = (s: any) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function device(ua: string) {
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "Phone";
  return ua ? "Computer" : null;
}

async function geo(ip: string | null) {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return { city: null, region: null, country: null };
  try {
    const g = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,regionName,country`, { signal: AbortSignal.timeout(2500) }).then((r) => r.json());
    if (g.status === "success") return { city: g.city || null, region: g.regionName || null, country: g.country || null };
  } catch {}
  return { city: null, region: null, country: null };
}

const SCREEN: Record<string, string> = { site: "Demo website", office: "Entered the demo office", screen: "Office screen" };

export async function logProspect(req: Request, slugIn: any, kind: "site" | "office" | "screen", path?: string | null, sessionId?: string | null) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  // link previews (Gmail, iMessage, Slack…) and robots are not people
  if (/bot|crawl|spider|preview|headless|facebookexternalhit|slurp|vercel|lighthouse/i.test(req.headers.get("user-agent") || "")) return { ok: false };
  let slug = cleanSlug(slugIn);
  let g: { city: string | null; region: string | null; country: string | null } | null = null;
  // Oct 26 (per Mely): no personal link → still log it, grouped by the visitor's internet
  // connection (a short one-way code, never the address itself), so the website visit and the
  // office entry of the same person land together. Mely can rename it ("this was Hodge").
  const anon = slug.length < 2;
  if (anon) {
    if (!ip) return { ok: false };
    slug = "v-" + createHash("sha256").update(`melyos-demo:${ip}`).digest("hex").slice(0, 10);
  }
  let { data: p } = await supabaseAdmin.from("demo_prospects").select("*").eq("slug", slug).maybeSingle();
  if (!p) {
    g = await geo(ip);
    const place = [g.city, g.region].filter(Boolean).join(", ");
    // a link Mely typed by hand (e.g. ?d=hodge) works without creating it first
    const name = anon ? `Visitor${place ? ` from ${place}` : ""}` : slug.replace(/-/g, " ");
    const ins = await supabaseAdmin.from("demo_prospects").insert({ slug, name }).select("*").single();
    p = ins.data || (await supabaseAdmin.from("demo_prospects").select("*").eq("slug", slug).maybeSingle()).data;
    if (!p) return { ok: false };
  }
  const now = Date.now();
  if (!g) g = await geo(ip);
  const ua = req.headers.get("user-agent") || "";

  const { data: lastOffice } = kind === "office"
    ? await supabaseAdmin.from("demo_prospect_events").select("at").eq("prospect_id", p.id).eq("kind", "office").order("at", { ascending: false }).limit(1)
    : { data: null as any };
  const newVisit = !p.last_seen_at || now - new Date(p.last_seen_at).getTime() > GAP;
  const newOffice = kind === "office" && (!lastOffice?.length || now - new Date(lastOffice[0].at).getTime() > GAP);

  await supabaseAdmin.from("demo_prospect_events").insert({ prospect_id: p.id, kind, path: String(path || "").slice(0, 200) || null, session_id: String(sessionId || "").slice(0, 60) || null, ...g, device: device(ua) });
  await supabaseAdmin.from("demo_prospects").update({
    last_seen_at: new Date(now).toISOString(),
    first_seen_at: p.first_seen_at || new Date(now).toISOString(),
    visits: (p.visits || 0) + (newVisit ? 1 : 0),
    office_entries: (p.office_entries || 0) + (kind === "office" ? 1 : 0),
  }).eq("id", p.id);

  if ((newVisit || newOffice) && !p.ignored) {
    const who = p.name || slug;
    const place = [g.city, g.region, g.country].filter(Boolean).join(", ");
    const time = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const what = newOffice ? "entró a la oficina demo" : "abrió el demo";
    const subject = anon && !p.renamed ? `👀 Alguien ${what}${place ? ` · ${place}` : ""}` : `👀 ${who} ${what}`;
    const lines = [
      anon && !p.renamed ? `Alguien ${what} (sin enlace personal). Si sabes quién es, ponle el nombre en MelyOS Insights → Demo prospects.` : `<b>${esc(who)}</b>${p.email ? ` (${esc(p.email)})` : ""} ${what}.`,
      `${esc(time)} (hora de Florida)${place ? ` · ${esc(place)}` : ""}${device(ua) ? ` · ${device(ua)}` : ""}`,
      `${SCREEN[kind]}${path ? `: ${esc(path)}` : ""}`,
      `Visitas hasta ahora: ${(p.visits || 0) + (newVisit ? 1 : 0)} · entradas a la oficina: ${(p.office_entries || 0) + (kind === "office" ? 1 : 0)}`,
    ];
    if (process.env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "MelyOS Demo <noreply@aloharvparkfl.com>", to: OWNER, subject,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f2540">${lines.map((l) => `<p style="margin:0 0 10px">${l}</p>`).join("")}<p><a href="https://admin.melyos.io" style="display:inline-block;background:#0f2540;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:bold">See every visit (MelyOS Insights)</a></p></div>`,
        }),
      }).catch(() => null);
    }
  }
  return { ok: true };
}
