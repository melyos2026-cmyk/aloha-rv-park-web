import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 30 (per Mely — storage-only customers, money review #11): people who only rent an RV storage
// space (resident_accounts.account_type = 'storage') have no lot, no lease and no household. The
// portal hides those screens; these server checks refuse the matching API calls too, so nothing
// lot-related can be filed by hand. Missing column (storage_customers.sql not run) / read error →
// treated as a resident (unchanged behaviour).
export const STORAGE_REFUSED_MESSAGE =
  "This is not available for storage-only accounts. Please contact the office.";

export async function isStorageAccountId(residentId: string | null | undefined): Promise<boolean> {
  if (!residentId) return false;
  try {
    const { data, error } = await supabaseAdmin.from("resident_accounts").select("account_type").eq("id", residentId).maybeSingle();
    if (error) return false;
    return String((data as any)?.account_type || "").toLowerCase() === "storage";
  } catch {
    return false;
  }
}

/** 403 with a clear message for a storage-only account; null for everyone else. */
export async function refuseStorageAccount(residentId: string | null | undefined): Promise<NextResponse | null> {
  if (!(await isStorageAccountId(residentId))) return null;
  return NextResponse.json({ error: STORAGE_REFUSED_MESSAGE, storageAccount: true }, { status: 403 });
}
