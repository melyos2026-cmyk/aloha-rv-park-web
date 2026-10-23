import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMarinaForRequest } from "@/lib/marina/company";
import { isDemoDomain } from "@/lib/marina/host";
import { moduleOn } from "@/lib/concierge";
import { loadCareersSettings } from "@/lib/careers";
import { calculateProcessingFee } from "@/lib/platformFee";

// Oct 23 (per Mely): Careers & Crew — a person applies (multipart: fields + license photo),
// then PAYS THEIR OWN background check (same Checkr flow the RV parks use; the invitation is
// sent by the Stripe webhook when the payment lands). The office approves or rejects in the admin.
// POST multipart → { ok, applicantId, payUrl? }   ·   POST json { action:"pay", applicantId } → { url }
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await moduleOn(company.id, "careers"))) return NextResponse.json({ error: "We are not taking applications online right now." }, { status: 400 });
  const settings = await loadCareersSettings(company.id);
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    if (b.action !== "pay") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    const { data: a } = await supabaseAdmin.from("crew_applicants").select("*").eq("id", String(b.applicantId || "")).eq("company_id", company.id).maybeSingle();
    if (!a) return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (a.bgc_status !== "not_started") return NextResponse.json({ error: "The background check was already started." }, { status: 400 });
    return startBgcPayment(company, a, settings.bgcFee);
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form." }, { status: 400 });
  const full_name = text(form.get("name"), 120), email = text(form.get("email"), 160).toLowerCase(), phone = text(form.get("phone"), 40);
  const roles = text(form.get("roles"), 200), experience = text(form.get("experience"), 3000), certifications = text(form.get("certifications"), 1000), availability = text(form.get("availability"), 300);
  const rate = Number(form.get("hourly_rate")) || null;
  if (!full_name || !roles) return NextResponse.json({ error: "Please enter your name and the roles you can do." }, { status: 400 });
  if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(email)) return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  if (!form.get("consent")) return NextResponse.json({ error: "Please agree to the background check and privacy terms." }, { status: 400 });

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

  if (!settings.requireBgc || a.bgc_status !== "not_started") return NextResponse.json({ ok: true, applicantId: a.id });
  const pay = await startBgcPayment(company, a, settings.bgcFee);
  const pj = await pay.json();
  return NextResponse.json({ ok: true, applicantId: a.id, ...pj });
}

async function startBgcPayment(company: any, a: any, fee: number) {
  if (isDemoDomain(company.domain)) {
    // Demo: no card, no Checkr — mark as paid + in progress so the flow can be shown.
    await supabaseAdmin.from("crew_applicants").update({ bgc_status: "in_progress", bgc_paid_at: new Date().toISOString(), bgc_stripe_session_id: `demo:${a.id}`, updated_at: new Date().toISOString() }).eq("id", a.id);
    return NextResponse.json({ ok: true, demo: true });
  }
  const processing = calculateProcessingFee(fee);
  // The applicant pays MelyOS directly (MelyOS pays Checkr); the marina is not charged and gets no share.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], customer_email: a.email,
      line_items: [
        { quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(fee * 100), product_data: { name: `${company.company_name}: crew background check`, description: `Background check for ${a.full_name}` } } },
        { quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(processing * 100), product_data: { name: "Card Processing Fee" } } },
      ],
      metadata: { type: "crew_background_check", company_id: company.id, applicant_id: a.id },
      success_url: `https://${company.domain}/marina/careers?paid=1`,
      cancel_url: `https://${company.domain}/marina/careers?paid=0`,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Could not start payment." }, { status: 500 });
  }
}
