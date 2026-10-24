import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { moduleOn } from "@/lib/concierge";
import { loadCareersSettings } from "@/lib/careers";

// Oct 23 (per Mely): Careers & Crew — a person applies (multipart: fields + license photo). The
// applicant pays nothing: if the marina runs background checks, the office starts one from the
// admin and MelyOS bills the marina. The office approves or rejects in the admin.
// POST multipart → { ok, applicantId }
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await moduleOn(company.id, "careers"))) return NextResponse.json({ error: "We are not taking applications online right now." }, { status: 400 });
  const settings = await loadCareersSettings(company.id);

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form." }, { status: 400 });
  const full_name = text(form.get("name"), 120), email = text(form.get("email"), 160).toLowerCase(), phone = text(form.get("phone"), 40);
  const roles = text(form.get("roles"), 200), experience = text(form.get("experience"), 3000), certifications = text(form.get("certifications"), 1000), availability = text(form.get("availability"), 300);
  const rate = Number(form.get("hourly_rate")) || null;
  if (!full_name || !roles) return NextResponse.json({ error: "Please enter your name and the roles you can do." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!form.get("consent")) return NextResponse.json({ error: "Please confirm your information and agree to the privacy terms." }, { status: 400 });

  const { count } = await supabaseAdmin.from("crew_applicants").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((count || 0) >= 30) return NextResponse.json({ error: "Too many applications right now. Please try again later." }, { status: 429 });

  // License / ID photo → private bucket
  let license_photo_path: string | null = null;
  const file = form.get("license");
  if (file && typeof file !== "string" && file.size > 0) {
    if (!/^image\/|application\/pdf$/.test(file.type || "")) return NextResponse.json({ error: "Upload a photo or PDF of your license." }, { status: 400 });
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    license_photo_path = `crew/${company.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await supabaseAdmin.storage.from("resident-documents").upload(license_photo_path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
    if (up.error) return NextResponse.json({ error: "Could not upload your license. Please try again." }, { status: 500 });
  }

  const { data: a, error } = await supabaseAdmin.from("crew_applicants")
    .upsert({ company_id: company.id, full_name, email, phone: phone || null, roles, experience: experience || null, certifications: certifications || null, availability: availability || null, hourly_rate: rate, ...(license_photo_path ? { license_photo_path } : {}), updated_at: new Date().toISOString() }, { onConflict: "company_id,email" })
    .select("*").single();
  if (error || !a) return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500 });
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: full_name, update_type: "crew_application", message: `New crew application: ${full_name} (${roles})${settings.requireBgc ? " — background check pending" : ""}.` }).then(() => null, () => null);

  return NextResponse.json({ ok: true, applicantId: a.id });
}
