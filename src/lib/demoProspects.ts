import { createClient } from "@supabase/supabase-js";


// Oct 26 (per Mely): personal demo links. A prospect opens marinademo.melyos.io/?d=<slug>; the
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
  const slug = cleanSlug(slugIn);
  if (slug.length < 2) return { ok: false };
  let { data: p } = await supabaseAdmin.from("demo_prospects").select("*").eq("slug", slug).maybeSingle();
  if (!p) {
    // a link Mely typed by hand (e.g. ?d=hodge) works without creating it first
    const ins = await supabaseAdmin.from("demo_prospects").insert({ slug, name: slug.replace(/-/g, " ") }).select("*").single();
    p = ins.data || (await supabaseAdmin.from("demo_prospects").select("*").eq("slug", slug).maybeSingle()).data;
    if (!p) return { ok: false };
  }
  const now = Date.now();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const g = await geo(ip);
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

  if (newVisit || newOffice) {
    const who = p.name || slug;
    const place = [g.city, g.region, g.country].filter(Boolean).join(", ");
    const time = new Date(now).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const what = newOffice ? "entró a la oficina demo" : "abrió el demo";
    const subject = `👀 ${who} ${what}`;
    const lines = [
      `<b>${esc(who)}</b>${p.email ? ` (${esc(p.email)})` : ""} ${what}.`,
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
