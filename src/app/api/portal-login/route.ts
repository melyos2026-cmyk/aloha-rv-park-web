import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Enter email and password." }, { status: 400 });
  }

  const { data: resident, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, full_name, portal_password")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !resident || !resident.portal_password) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const matches = await bcrypt.compare(password, resident.portal_password);
  if (!matches) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return NextResponse.json({ id: resident.id, full_name: resident.full_name });
}
