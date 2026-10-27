import { ImageResponse } from "next/og";
import { getMarinaForRequest } from "@/lib/marina/company";

// GET /api/marina/app/icon?size=192|512[&maskable=1] — Oct 26 (per Mely): the marina app's home-screen
// icon. The marina's logo on its brand color, or a brass anchor with the marina's initials.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  const u = new URL(req.url);
  const size = u.searchParams.get("size") === "192" ? 192 : u.searchParams.get("size") === "180" ? 180 : 512;
  const maskable = u.searchParams.get("maskable") === "1";
  const color = /^#[0-9a-f]{3,8}$/i.test(String(company?.primary_color || "")) ? company!.primary_color! : "#0f2540";
  const name = company?.company_name || "Marina";
  const initials = name.replace(/\b(marina|the|and|&)\b/gi, "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "M";
  let logo: string | null = null;
  try {
    const l = company?.logo_url ? new URL(company.logo_url, u.origin) : null;
    if (l && l.protocol === "https:") logo = l.toString();
  } catch {}
  const pad = Math.round(size * (maskable ? 0.2 : 0.12));
  const inner = size - pad * 2;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, background: color, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={inner} height={inner} style={{ objectFit: "contain", borderRadius: Math.round(inner * 0.18), background: "#ffffff" }} alt="" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#c9a96a" }}>
            <svg width={Math.round(inner * 0.5)} height={Math.round(inner * 0.5)} viewBox="0 0 24 24" fill="none" stroke="#c9a96a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v14M8 11h8M4 14c0 4 3.5 7 8 7s8-3 8-7M4 14l-1.5 2M20 14l1.5 2" />
            </svg>
            <div style={{ display: "flex", fontSize: Math.round(inner * 0.2), fontWeight: 700, color: "#ffffff", marginTop: Math.round(inner * 0.04), letterSpacing: 2 }}>{initials}</div>
          </div>
        )}
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
