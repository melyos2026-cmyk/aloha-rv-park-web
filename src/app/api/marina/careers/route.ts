import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { moduleOn } from "@/lib/concierge";
import { loadCareersSettings } from "@/lib/careers";
import { tooManyFromIp } from "@/lib/marina/ipLimit";
import { sniff } from "@/lib/marina/fileType";

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
  const languages = text(form.get("languages"), 200) || null, vessel_types = text(form.get("vessel_types"), 300) || null, certs = text(form.get("certs"), 300) || null, references_text = text(form.get("references_text"), 1000) || null;
  const exp = text(form.get("license_expires"), 10); const license_expires = /^\d{4}-\d{2}-\d{2}$/.test(exp) ? exp : null;
  const wa = text(form.get("work_authorized"), 3); const work_authorized = wa === "yes" ? true : wa === "no" ? false : null;
  if (!full_name || !roles) return NextResponse.json({ error: "Please enter your name and the roles you can do." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!form.get("consent")) return NextResponse.json({ error: "Please confirm your information and agree to the privacy terms." }, { status: 400 });

  const { count } = await supabaseAdmin.from("crew_applicants").select("id", { count: "exact", head: true }).eq("company_id", company.id).gte("created_at", new Date(Date.now() - 3600 * 1000).toISOString());
  if ((count || 0) >= 30) return NextResponse.json({ error: "Too many applications right now. Please try again later." }, { status: 429 });
  if (await tooManyFromIp(req, `careers:${company.id}`, 4)) return NextResponse.json({ error: "Too many applications from this device. Please try again later." }, { status: 429 });

  // Oct 24 (security run): an application is never overwritten from the public form (anyone who
  // knew the email could have replaced it, even during a background check). A second application
  // with the same email just tells the office.
  const { data: existing } = await supabaseAdmin.from("crew_applicants").select("id").eq("company_id", company.id).ilike("email", email.replace(/[%_\\]/g, "\\$&")).maybeSingle();
  if (existing) {
    await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: full_name, update_type: "crew_application", message: `${full_name} (${email}) sent the crew application again. The first one is kept; contact them if something changed.` }).then(() => null, () => null);
    return NextResponse.json({ ok: true, already: true });
  }

  // License / ID photo → private bucket. Type checked from the file itself (photo or PDF only).
  let license_photo_path: string | null = null;
  const file = form.get("license");
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "That file is too large (max 10 MB)." }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) return NextResponse.json({ error: "Upload a photo (JPG, PNG, WebP, HEIC) or PDF of your license." }, { status: 400 });
    license_photo_path = `crew/${company.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${kind.ext}`;
    const up = await supabaseAdmin.storage.from("resident-documents").upload(license_photo_path, buf, { contentType: kind.type });
    if (up.error) return NextResponse.json({ error: "Could not upload your license. Please try again." }, { status: 500 });
  }

  const { data: a, error } = await supabaseAdmin.from("crew_applicants")
    .insert({ company_id: company.id, full_name, email, phone: phone || null, roles, experience: experience || null, certifications: certifications || null, availability: availability || null, hourly_rate: rate, languages, vessel_types, certs, references_text, license_expires, work_authorized, ...(license_photo_path ? { license_photo_path } : {}), updated_at: new Date().toISOString() })
    .select("id").single();
  if (error?.code === "23505") return NextResponse.json({ ok: true, already: true });
  if (error || !a) return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500 });
  await supabaseAdmin.from("resident_update_notifications").insert({ company_id: company.id, resident_name: full_name, update_type: "crew_application", message: `New crew application: ${full_name} (${roles})${settings.requireBgc ? " — background check pending" : ""}.` }).then(() => null, () => null);

  return NextResponse.json({ ok: true });
}
