import { supabaseAdmin } from "@/lib/supabase-admin";
import { getRequestHostname, hostnameFromRequest } from "./host";

export type MarinaCompany = {
  id: string;
  company_name: string;
  domain: string;
  business_type: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  hero_image_url: string | null;
  hero_headline: string | null;
  hero_subtext: string | null;
  events_calendar_pdf_url?: string | null;
  is_demo?: boolean;   // Oct 24: from companies (see isDemoCompany)
  // Oct 26 (security review): true only when the demo flag was actually read and is true. is_demo
  // above is ALSO true when the flag couldn't be read (so payments never charge on a guess); this
  // one is for things that must only happen on a real demo, like showing the sign-in code on screen.
  demo_flag_confirmed?: boolean;   // Oct 24: monthly events calendar (PDF or image), same field as the RV parks
};

const COLUMNS =
  "id, company_name, domain, business_type, address, contact_phone, contact_email, logo_url, primary_color, secondary_color, hero_image_url, hero_headline, hero_subtext, events_calendar_pdf_url";

async function byHostname(hostname: string): Promise<MarinaCompany | null> {
  if (!hostname) return null;
  const { data } = await supabaseAdmin
    .from("public_company_profile")
    .select(COLUMNS)
    .eq("domain", hostname)
    .maybeSingle();
  const c = (data as MarinaCompany | null) || null;
  if (!c) return null;
  // Oct 24: the demo flag lives on companies (not in the public view). If it can't be read, the
  // company counts as a demo — never charge a card on a guess.
  const { data: flag, error } = await supabaseAdmin.from("companies").select("is_demo").eq("id", c.id).maybeSingle();
  // Oct 26 (security review): remember whether the flag was really read, so a failed read never
  // reveals a sign-in code on screen for a real marina (see isConfirmedDemo).
  return { ...c, is_demo: error || !flag ? true : flag.is_demo === true, demo_flag_confirmed: !error && !!flag && flag.is_demo === true };
}

// Returns the marina for this host, or null when the host is anything else
// (an RV park, an unknown domain). Every marina route and page starts here,
// so no marina data is ever served on a non-marina domain.
export async function getMarinaForPage(): Promise<MarinaCompany | null> {
  const company = await byHostname(await getRequestHostname());
  return company?.business_type === "marina" ? company : null;
}

export async function getMarinaForRequest(req: Request): Promise<MarinaCompany | null> {
  const company = await byHostname(hostnameFromRequest(req));
  return company?.business_type === "marina" ? company : null;
}

// Oct 26: the marina by id (payment hooks and other background steps that have no request host).
export async function getMarinaById(id: string): Promise<MarinaCompany | null> {
  const { data } = await supabaseAdmin.from("public_company_profile").select(COLUMNS).eq("id", id).maybeSingle();
  const c = (data as MarinaCompany | null) || null;
  if (!c || c.business_type !== "marina") return null;
  const { data: flag, error } = await supabaseAdmin.from("companies").select("is_demo").eq("id", c.id).maybeSingle();
  // Oct 26 (security review): remember whether the flag was really read, so a failed read never
  // reveals a sign-in code on screen for a real marina (see isConfirmedDemo).
  return { ...c, is_demo: error || !flag ? true : flag.is_demo === true, demo_flag_confirmed: !error && !!flag && flag.is_demo === true };
}
