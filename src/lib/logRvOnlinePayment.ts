import { supabaseAdmin } from "@/lib/supabase-admin";
import { logSystemHealthIssue } from "@/lib/logSystemHealthIssue";

// Oct 8 (per Mely — Shifts & Daily Close): every payment made online through Stripe is also written to
// the RV-park payment ledger (shown separately from the drawer in Daily Close). Best-effort: it never
// throws and never touches the payment itself, but a failure is logged to System Health so the admin
// is told instead of it going unnoticed.
export async function logRvOnlinePayment(p: {
  companyId: string | null;
  sourceId: string;
  description: string;
  payerName?: string | null;
  amountCents: number;
  reference?: string | null;
}): Promise<void> {
  let companyId = p.companyId;
  try {
    if (!companyId) {
      // This website is Aloha's: if a charge carries no company information, it is Aloha's.
      const { data } = await supabaseAdmin.from("companies").select("id").eq("park_id", "aloha").maybeSingle();
      companyId = data?.id || null;
    }
    if (!companyId) {
      console.error("logRvOnlinePayment: no company for", p.sourceId);
      return;
    }
    const { error } = await supabaseAdmin.from("rv_shift_payments").upsert({
      company_id: companyId,
      shift_id: null,
      source_type: "stripe_online",
      source_id: p.sourceId,
      description: p.description,
      payer_name: p.payerName || null,
      amount: Math.round(Number(p.amountCents || 0)) / 100,
      method: "stripe",
      reference: p.reference || null,
      recorded_by_name: "Online payment",
    }, { onConflict: "company_id,source_type,source_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } catch (err: any) {
    console.error("logRvOnlinePayment failed:", err?.message);
    if (companyId) {
      await logSystemHealthIssue({
        companyId, issueType: "shift_ledger_failed", source: "stripe",
        message: `An online payment was received but could not be added to Shifts & Daily Close (${err?.message || "unknown error"}). Reference ${p.sourceId}.`,
      });
    }
  }
}
