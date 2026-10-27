// Oct 26 (per Mely — "cada estado tenga su regla"): the starting point for a marina's repair-shop
// rules, by the marina's state. Each marina can change every value in Work Orders → Settings; this
// only fills the defaults. Add a state here once its rules are confirmed (with an accountant/lawyer).
//
// Florida (confirmed Oct 26, 2026):
//   · Sales tax applies to boat repairs — parts AND labor (labor-only work that adds nothing to the
//     boat can be exempt when documented) → labor taxable by default, the office can untick a line.
//   · Marinas hold a possessory lien for repairs, storage and dockage (F.S. 328.17).
//   · The Motor Vehicle Repair Act (F.S. 559.901+) excludes watercraft.
export type StateRules = { code: string; name: string; labor_taxable: boolean | null; shop_fee_taxable: boolean | null; lien_notice: string; note: string };

const FL: StateRules = {
  code: "FL", name: "Florida", labor_taxable: true, shop_fee_taxable: true,
  lien_notice: "Under Florida law (s. 328.17, F.S.), the marina holds a lien on the vessel for unpaid repair, storage and dockage charges and may sell the vessel to satisfy the lien after the notice the law requires.",
  note: "Florida: sales tax applies to boat repair parts and labor. Untick tax on a line only for labor-only work that adds nothing to the boat.",
};

const GENERIC: StateRules = {
  code: "", name: "", labor_taxable: null, shop_fee_taxable: null,
  lien_notice: "The marina may hold a lien on the vessel for unpaid repair, storage and dockage charges as allowed by state law.",
  note: "Your state's rules aren't set up in MelyOS yet. Check with your accountant whether labor is taxable and set it below.",
};

const STATES: Record<string, StateRules> = { FL };
const NAMES: Record<string, string> = { florida: "FL", georgia: "GA", alabama: "AL", "south carolina": "SC", "north carolina": "NC", texas: "TX", louisiana: "LA", mississippi: "MS", "puerto rico": "PR" };

export function rulesForState(state: string | null | undefined): StateRules {
  const s = String(state || "").trim();
  const code = s.length === 2 ? s.toUpperCase() : NAMES[s.toLowerCase()] || "";
  return STATES[code] || { ...GENERIC, code, name: s };
}
