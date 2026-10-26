import crypto from "crypto";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { getMarinaSession } from "@/lib/marina/session";

// Oct 26 (per Mely — boater pass): a QR in Boater login. At the ship store or fuel dock the
// cashier scans it and the sale goes to this boater (charged to the account when the marina
// allows it). "New code" makes the old QR stop working (lost phone, screenshot shared…).
async function who(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return null;
  const s = await getMarinaSession(req);
  if (!s || s.companyId !== company.id) return null;
  return { company, memberId: s.memberId };
}
async function render(token: string) {
  const code = `MPASS:${token}`;
  return { code, qr: await QRCode.toDataURL(code, { width: 360, margin: 1, color: { dark: "#0f2540", light: "#ffffff" } }) };
}

export async function GET(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: m, error } = await supabaseAdmin.from("marina_members").select("pass_token, full_name").eq("id", w.memberId).eq("company_id", w.company.id).maybeSingle();
  if (error) return NextResponse.json({ notReady: true });
  let token = m?.pass_token as string | null;
  if (!token) {
    token = crypto.randomBytes(16).toString("hex");
    await supabaseAdmin.from("marina_members").update({ pass_token: token }).eq("id", w.memberId).eq("company_id", w.company.id).is("pass_token", null);
    const again = await supabaseAdmin.from("marina_members").select("pass_token").eq("id", w.memberId).maybeSingle();
    token = again.data?.pass_token || token;
  }
  return NextResponse.json({ name: m?.full_name, ...(await render(token!)) });
}

export async function POST(req: Request) {
  const w = await who(req);
  if (!w) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const token = crypto.randomBytes(16).toString("hex");
  const { error } = await supabaseAdmin.from("marina_members").update({ pass_token: token }).eq("id", w.memberId).eq("company_id", w.company.id);
  if (error) return NextResponse.json({ error: "Could not make a new code." }, { status: 500 });
  return NextResponse.json(await render(token));
}
