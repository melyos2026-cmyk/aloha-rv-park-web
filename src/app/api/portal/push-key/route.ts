import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

// Oct 9 (per Mely): public Web Push (VAPID) key for the resident portal app.
// The key pair lives in public.push_config and is created on first use (this
// route or the admin app's), so there is nothing to set in Vercel.
export async function GET() {
  const read = async () => {
    const { data } = await supabase.from("push_config").select("public_key").eq("id", 1).maybeSingle();
    return data?.public_key as string | undefined;
  };
  try {
    let key = await read();
    if (!key) {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      await supabase
        .from("push_config")
        .upsert(
          { id: 1, public_key: ecdh.getPublicKey().toString("base64url"), private_key: ecdh.getPrivateKey().toString("base64url") },
          { onConflict: "id", ignoreDuplicates: true }
        );
      key = await read();
    }
    if (!key) return NextResponse.json({ error: "Push is not set up yet." }, { status: 503 });
    return NextResponse.json({ publicKey: key });
  } catch {
    return NextResponse.json({ error: "Push is not set up yet." }, { status: 503 });
  }
}
