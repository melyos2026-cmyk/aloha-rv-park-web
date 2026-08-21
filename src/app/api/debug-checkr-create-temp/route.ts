import { NextRequest, NextResponse } from "next/server";

// TEMPORARY DIAGNOSTIC ROUTE — Aug 21, delete after resolving why
// createCheckrInvitation is failing for every applicant even after
// reverting CHECKR_ENVIRONMENT to staging. Attempts the EXACT same
// /candidates POST call the real webhook makes, using the exact same
// env vars, and returns the raw Checkr response (or thrown error
// message) so we can see the real cause without hunting through logs.
export async function GET(req: NextRequest) {
  const CHECKR_ENVIRONMENT = process.env.CHECKR_ENVIRONMENT || "staging";
  const CHECKR_API_BASE =
    CHECKR_ENVIRONMENT === "production"
      ? "https://api.checkr.com/v1"
      : "https://api.checkr-staging.com/v1";
  const CHECKR_API_KEY = process.env.CHECKR_API_KEY as string;
  const encoded = Buffer.from(`${CHECKR_API_KEY}:`).toString("base64");

  try {
    const res = await fetch(`${CHECKR_API_BASE}/candidates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${encoded}`,
      },
      body: JSON.stringify({
        email: "diagnostic-test@example.com",
        first_name: "Diagnostic",
        last_name: "Test",
        custom_id: "diagnostic-test-temp",
        work_locations: [{ country: "US", state: "FL" }],
      }),
    });

    const json = await res.json();

    return NextResponse.json({
      environmentUsed: CHECKR_ENVIRONMENT,
      apiBaseUsed: CHECKR_API_BASE,
      apiKeyPresent: !!CHECKR_API_KEY,
      apiKeyLength: CHECKR_API_KEY?.length ?? 0,
      responseStatus: res.status,
      responseOk: res.ok,
      rawResponse: json,
    });
  } catch (err: any) {
    return NextResponse.json({
      environmentUsed: CHECKR_ENVIRONMENT,
      apiBaseUsed: CHECKR_API_BASE,
      apiKeyPresent: !!CHECKR_API_KEY,
      caughtError: err?.message || String(err),
    });
  }
}
