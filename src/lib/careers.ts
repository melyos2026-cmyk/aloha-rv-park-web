import { supabaseAdmin } from "@/lib/supabase-admin";

// Oct 23 (per Mely): Careers & Crew — shared helpers.
export async function loadCareersSettings(companyId: string) {
  const { data } = await supabaseAdmin.from("careers_settings").select("*").eq("company_id", companyId).maybeSingle();
  return {
    title: (data?.page_title || "").trim() || "Careers & Crew",
    intro: (data?.page_intro || "").trim() || "Join our crew. Captains, mates, deckhands, boat cleaners and dock hands: tell us about yourself, upload your license and complete a background check. We'll be in touch.",
    roles: String(data?.roles_offered || "Captain, Mate, Deckhand, Boat cleaner, Dock hand").split(",").map((s: string) => s.trim()).filter(Boolean),
    bgcFee: Number(data?.bgc_fee ?? 49.99),
    requireBgc: data?.require_bgc !== false,
  };
}
