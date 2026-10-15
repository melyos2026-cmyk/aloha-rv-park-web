import { getMarinaForPage } from "@/lib/marina/company";
import MarinaHome from "@/components/marina/MarinaHome";
import RvHome from "@/components/RvHome";

export const dynamic = "force-dynamic";

// One website, many companies: a marina domain shows the marina site,
// every other domain keeps the RV-park home page exactly as before.
export default async function Home() {
  // If the marina lookup ever fails, fall back to the RV-park page rather than showing an error.
  const marina = await getMarinaForPage().catch(() => null);
  if (marina) return <MarinaHome company={marina} />;
  return <RvHome />;
}
