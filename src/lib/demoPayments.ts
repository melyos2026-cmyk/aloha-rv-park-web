import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 21 (per Mely — demo.melyos.io is now public): demo companies must never take
// a real card payment. A company is a demo when it is marked is_demo or its website
// is a *.melyos.io demo address. Real parks (Aloha, future clients) are not affected.
// Returns a ready 403 response for demo companies, or null to continue normally.
export async function demoPaymentBlock(companyId: string | null | undefined): Promise<NextResponse | null> {
  if (!companyId) return null;
  const { data } = await supabaseAdmin.from("companies").select("is_demo, domain").eq("id", companyId).maybeSingle();
  const demo = !!data && (data.is_demo === true || /(^|\.)melyos\.io$/i.test(String(data.domain || "")));
  if (!demo) return null;
  return NextResponse.json(
    { error: "This is a demo website — online payments are turned off. No card was charged." },
    { status: 403 }
  );
}
