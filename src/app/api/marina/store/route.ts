import { NextResponse } from "next/server";
import { getMarinaForRequest } from "@/lib/marina/company";
import { searchStoreItems } from "@/lib/marina/data";

// Oct 23 (per Mely): one page of the marina's store (by category and search) for the store page.
export async function GET(req: Request) {
  const company = await getMarinaForRequest(req);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const u = new URL(req.url).searchParams;
  const r = await searchStoreItems(company.id, { category: u.get("cat") || undefined, subcategory: u.get("sub") || undefined, q: u.get("q") || undefined, page: Number(u.get("page") || 0) });
  return NextResponse.json(r);
}
