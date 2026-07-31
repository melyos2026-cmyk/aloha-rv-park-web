import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { validatePassword } from "@/lib/passwordRules";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { token, password } = await req.json();

  if (!token || !password) {
    return NextResponse.json(
      { error: "Token and password are required" },
      { status: 400 }
    );
  }

  const complexityError = validatePassword(password);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  const { data, error: resetError } = await supabaseAdmin
    .from("resident_password_resets")
    .select("*")
    .eq("token", token)
    .is("used_at", null);

  const resetRow = data?.[0];

  if (resetError || !resetRow) {
    return NextResponse.json(
      { error: "Reset link is invalid or expired." },
      { status: 400 }
    );
  }

  if (resetRow.expires_at && new Date(resetRow.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Reset link is invalid or expired." },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const { error: updateError } = await supabaseAdmin
    .from("resident_accounts")
    .update({ portal_password: hashedPassword })
    .eq("id", resetRow.resident_id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  await supabaseAdmin
    .from("resident_password_resets")
    .update({ used_at: new Date().toISOString() })
    .eq("id", resetRow.id);

  return NextResponse.json({ success: true });
}
