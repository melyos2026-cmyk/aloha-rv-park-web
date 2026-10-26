import { NextRequest, NextResponse } from "next/server";

// Oct 26 (security review): no built-in username/password ("aloha"/"changeme" were guessable).
// This is the pre-launch staging gate. The live sites (resident portal, marina) must stay open,
// so when SITE_PASSWORD_USER / SITE_PASSWORD aren't both set the gate is simply OFF — it never
// falls back to a known password. (Note: with the app in src/app, Next only runs a middleware/
// proxy file placed in src/, so this root-level file is likely not running at all today.)
const SITE_USER = process.env.SITE_PASSWORD_USER || "";
const SITE_PASS = process.env.SITE_PASSWORD || "";

export function middleware(req: NextRequest) {
  if (!SITE_USER || !SITE_PASS) return NextResponse.next();

  // Public marina demo site: open to buyers without the shared staging password.
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  // Oct 21 (per Mely): the RV park demo (demo.melyos.io) is public too, so anyone she sends the link
  // to can see it and WhatsApp can show the preview. Aloha's own site keeps the password until launch.
  if (host === "marinademo.melyos.io" || host === "tohodemo.melyos.io" || host === "demo.melyos.io") return NextResponse.next();

  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    const encoded = authHeader.split(" ")[1] || "";
    const decoded = Buffer.from(encoded, "base64").toString();
    const [user, pass] = decoded.split(":");

    if (user === SITE_USER && pass === SITE_PASS) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Secure Area"',
    },
  });
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|privacy$|terms$|text-messages$).*)",
  ],
};
