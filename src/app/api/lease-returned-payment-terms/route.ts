import { NextRequest, NextResponse } from "next/server";
import { loadReturnedFeeSettings } from "@/lib/platformFee";
import { returnedPaymentClause, RV_LEASE_PARTIES } from "@/lib/returnedFeeRules";

// GET /api/lease-returned-payment-terms?company_id=...
// Oct 28 (per Mely): the park's "Returned Payments" lease clause, built from its own returned-payment
// fee rule (company_fee_settings returned_fee_*), for the public /apply form to show with the other
// lease terms. Public on purpose: it is the same rule already disclosed to every payer — never MelyOS's
// share or charge. Text only; the fee itself is computed elsewhere (platformFee).
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("company_id");
  if (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId)) {
    return NextResponse.json({ error: "company_id is required." }, { status: 400 });
  }
  const settings = await loadReturnedFeeSettings(companyId, "rv");
  return NextResponse.json({ clause: returnedPaymentClause(settings, RV_LEASE_PARTIES) });
}
