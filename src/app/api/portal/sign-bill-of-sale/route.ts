import { NextRequest, NextResponse } from "next/server";
import { requireMatchingSession } from "@/lib/portalSession";
import { signBillOfSaleAsResident } from "@/lib/rentToOwnCompletion";

// POST /api/portal/sign-bill-of-sale
// Body: { residentId, companyId, signatureName }
// Resident's own side of digitally signing their Rent-to-Own Bill of
// Sale, once their plan is fully paid off and shows "pending_signatures".
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { residentId, companyId, signatureName } = body;

  if (!residentId || !companyId || !signatureName?.trim()) {
    return NextResponse.json(
      { error: "residentId, companyId, and signatureName are required." },
      { status: 400 }
    );
  }

  // SECURITY: same pattern as every other resident-facing portal route —
  // require the caller's own signed session to match this residentId.
  const authError = requireMatchingSession(req, residentId);
  if (authError) return authError;

  const result = await signBillOfSaleAsResident(residentId, companyId, signatureName.trim());
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true, completed: result.completed });
}
