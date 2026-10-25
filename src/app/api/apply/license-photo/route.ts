import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sniff } from "@/lib/marina/fileType";
import { tooManyFromIp } from "@/lib/marina/ipLimit";

// POST /api/apply/license-photo  (multipart: companyId, slot, file)  →  { path }
// Oct 24 (security run): applicants' ID/license photos are uploaded by the server into the
// PRIVATE license-photos bucket, so the bucket no longer needs a public "anyone can upload" rule.
// Real file type checked from its bytes, size capped, and a per-device hourly limit.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const companyId = String(form?.get("companyId") || "");
  const slot = String(form?.get("slot") || "photo").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "photo";
  const file = form?.get("file");
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !file || typeof file === "string") return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
  const { data: company } = await supabaseAdmin.from("companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (await tooManyFromIp(req, `license:${companyId}`, 20)) return NextResponse.json({ error: "Too many uploads from this device. Please try again later." }, { status: 429 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP, HEIC) or a PDF." }, { status: 400 });
  const path = `${companyId}/${crypto.randomUUID()}/${slot}.${kind.ext}`;
  const { error } = await supabaseAdmin.storage.from("license-photos").upload(path, buf, { contentType: kind.type });
  if (error) return NextResponse.json({ error: "Could not upload the photo. Please try again." }, { status: 500 });
  return NextResponse.json({ path });
}
