import { NextRequest, NextResponse } from "next/server";

// TEMPORARY DIAGNOSTIC ROUTE — Aug 20, delete after resolving why a
// candidate created via createCheckrInvitation (confirmed successful in
// our own DB, no error thrown) doesn't show up in Checkr's real
// dashboard when searched by email. Queries Checkr's own /candidates
// list endpoint directly, using the exact same env vars/auth the real
// webhook uses — reveals whether this is a real Checkr-side gap or
// something about how the dashboard search itself works, without
// creating any new test candidate.
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "email is required." }, { status: 400 });
  }

  const CHECKR_ENVIRONMENT = process.env.CHECKR_ENVIRONMENT || "staging";
  const CHECKR_API_BASE =
    CHECKR_ENVIRONMENT === "production"
      ? "https://api.checkr.com/v1"
      : "https://api.checkr-staging.com/v1";
  const CHECKR_API_KEY = process.env.CHECKR_API_KEY as string;

  const encoded = Buffer.from(`${CHECKR_API_KEY}:`).toString("base64");

  const res = await fetch(`${CHECKR_API_BASE}/candidates?email=${encodeURIComponent(email)}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${encoded}`,
    },
  });

  const json = await res.json();

  return NextResponse.json({
    environmentUsed: CHECKR_ENVIRONMENT,
    apiBaseUsed: CHECKR_API_BASE,
    apiKeyPresent: !!CHECKR_API_KEY,
    apiKeyLength: CHECKR_API_KEY?.length ?? 0,
    checkrResponseStatus: res.status,
    checkrResponse: json,
  });
}
