import { notFound } from "next/navigation";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

async function getCompanyByHost() {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host") || "";
  const domain = host.replace(/^www\./, "").split(":")[0];

  const { data } = await supabase
    .from("companies")
    .select("id, company_name")
    .eq("domain", domain)
    .maybeSingle();

  return data;
}

export default async function CustomPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await getCompanyByHost();

  if (!company) {
    notFound();
  }

  const { data: page } = await supabase
    .from("website_pages")
    .select("title, content, page_name")
    .eq("company_id", company.id)
    .eq("slug", slug)
    .maybeSingle();

  if (!page) {
    notFound();
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 24px" }}>
      <h1 style={{ fontFamily: "Playfair Display, serif", fontSize: 32, fontWeight: 900, marginBottom: 24 }}>
        {page.title || page.page_name}
      </h1>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 15 }}>{page.content}</div>
    </div>
  );
}
