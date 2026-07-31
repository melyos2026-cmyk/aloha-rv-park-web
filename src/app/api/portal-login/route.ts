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

  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

  const { data: resident, error } = await supabaseAdmin
    .from("resident_accounts")
    .select("id, full_name, company_id, portal_password")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !resident || !resident.portal_password) {
    // Log the attempt even if the email doesn't match a real account — still
    // useful history, just nothing to cross-reference yet.
    await supabaseAdmin.from("resident_login_attempts").insert({
      resident_id: resident?.id || null,
      attempted_email: email,
      ip,
      success: false,
    });
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const matches = await bcrypt.compare(password, resident.portal_password);

  await supabaseAdmin.from("resident_login_attempts").insert({
    resident_id: resident.id,
    attempted_email: email,
    ip,
    success: matches,
  });

  if (!matches) {
    // Someone got the account's email right but the password wrong. If this
    // IP was previously used for a SUCCESSFUL login by a DIFFERENT resident,
    // that's a meaningful signal in this park specifically (residents don't
    // share internet here, except a couple of known cases Mely is aware of).
    if (ip) {
      const { data: matchingLogin } = await supabaseAdmin
        .from("resident_login_attempts")
        .select("resident_id, resident_accounts(full_name)")
        .eq("ip", ip)
        .eq("success", true)
        .neq("resident_id", resident.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (matchingLogin && resident.company_id) {
        const otherName = (matchingLogin as any).resident_accounts?.full_name || "another resident";
        await supabaseAdmin.from("resident_update_notifications").insert({
          company_id: resident.company_id,
          resident_name: resident.full_name,
          update_type: "security_alert",
          message: `Failed login attempt on ${resident.full_name}'s account came from an IP previously used for a successful login by ${otherName}. Could be shared internet — worth checking with both residents.`,
        });
      }
    }

    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  return NextResponse.json({ id: resident.id, full_name: resident.full_name });
}
