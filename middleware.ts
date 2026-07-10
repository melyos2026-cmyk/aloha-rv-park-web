import { NextRequest, NextResponse } from "next/server";

const SITE_USER = process.env.SITE_PASSWORD_USER || "aloha";
const SITE_PASS = process.env.SITE_PASSWORD || "changeme";

export function middleware(req: NextRequest) {
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
    "/((?!api/stripe-webhook|_next/static|_next/image|favicon.ico).*)",
  ],
};
