"use client";
// Oct 30 (per Mely — "el menú de la izquierda tiene que trabajar en sincronía con cada página que
// abre a la derecha"): the resident portal's side menu (computer) + bottom tab bar (phone), shared
// by the dashboard and every portal sub-page (Invoices, Payment history, Electric history,
// Documents, Maintenance, Marketplace, Background checks…) so they can't drift apart.
//  · The dashboard renders <ResidentSideNav>/<ResidentTabBar> itself (it owns the section state).
//  · Sub-pages get them from <ResidentSubPageFrame> (in residents/layout.tsx and
//    electric-history/layout.tsx), which highlights the parent section + the current page and
//    sends every other click to /residents/dashboard#<section or anchor>.
//  · Sub-page links carry ?from=<section> so "Back" returns to the section it was opened from
//    (portalBackHref). Navigation / presentation only — no data is fetched here.
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePortalLang } from "@/lib/portalI18n";

export type SectionId = "home" | "pay" | "lot" | "household" | "requests" | "messages" | "info" | "more";
export const SECTIONS: { id: SectionId; label: string; short: string; icon: string }[] = [
  { id: "home", label: "Home", short: "Home", icon: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10" },
  { id: "pay", label: "Payments", short: "Pay", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { id: "lot", label: "My lot & home", short: "My lot", icon: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" },
  { id: "household", label: "Household", short: "Household", icon: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3" },
  { id: "requests", label: "Requests", short: "Requests", icon: "M14 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-3 3-3-3z" },
  { id: "messages", label: "Messages", short: "Messages", icon: "M4 5h16v11H8l-4 4z" },
  // Oct 28 (per Mely): office hours, emergency phone + what to do, after-hours note, park rules.
  { id: "info", label: "Park info", short: "Park info", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" },
  { id: "more", label: "Profile & more", short: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" },
];
const PROFILE_ICON = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0";
export const MOBILE_TABS: SectionId[] = ["home", "pay", "lot", "messages", "more"];
export const UNDER_MORE: SectionId[] = ["household", "requests", "info", "more"];
// Old anchors (from other pages and emails) → the section that now holds them.
export const ANCHOR_SECTION: Record<string, SectionId> = {
  "household-occupants": "household", "visitors-section": "household", vehicles: "household", "golf-carts": "household",
  "move-out": "lot", "move-out-request": "lot", "rent-to-own": "lot", "parking-pets": "lot", "home-info": "lot", documents: "lot",
  autopay: "pay", invoices: "pay", charges: "pay", electric: "pay",
  maintenance: "requests", propane: "requests", "rec-hall": "requests",
  announcements: "messages", notifications: "messages",
  profile: "more", "resident-info": "more", "emergency-contact": "more", marketplace: "more",
  "park-info": "info", emergency: "info", "emergency-line": "info", "office-hours": "info", "park-rules": "info",
  "lease-addendum": "home", // Oct 28: Lease Addenda card (link in the "please sign" email)
};
export const ANCHORS = Object.keys(ANCHOR_SECTION);
// Oct 29 (per Mely — "que el menú enseñe lo que tienen adentro, como Documents"): what each section
// holds, shown under the open section in the side menu and as quick links at the top on a phone.
// Oct 30 (per Mely): every page that belongs to a section is listed too (Invoices, Payment history,
// Electric history, Background checks, the Maintenance and Marketplace pages).
export type SubItem = { label: string; anchor?: string; href?: string };
export const SUBMENU: Partial<Record<SectionId, SubItem[]>> = {
  pay: [
    { label: "Autopay", anchor: "autopay" }, { label: "Charges & invoices", anchor: "charges" },
    { label: "Invoices", href: "/residents/invoices" }, { label: "Payment history", href: "/residents/payment-history" },
    { label: "Electric usage", anchor: "electric" }, { label: "Electric history", href: "/electric-history" },
  ],
  lot: [{ label: "Home info", anchor: "home-info" }, { label: "Parking & pets", anchor: "parking-pets" }, { label: "Rent-to-own", anchor: "rent-to-own" }, { label: "Documents", href: "/residents/documents" }, { label: "Moving out", anchor: "move-out" }],
  household: [{ label: "Occupants", anchor: "household-occupants" }, { label: "Visitors", anchor: "visitors-section" }, { label: "Vehicles", anchor: "vehicles" }, { label: "Golf carts", anchor: "golf-carts" }, { label: "Background checks", href: "/residents/background-checks" }],
  // Oct 30: Maintenance opens the Maintenance page (the section's anchor only held a link to it).
  requests: [{ label: "Maintenance", anchor: "maintenance", href: "/residents/maintenance" }, { label: "Propane", anchor: "propane" }, { label: "Rec Hall", anchor: "rec-hall" }],
  messages: [{ label: "Notifications", anchor: "notifications" }, { label: "Announcements", anchor: "announcements" }],
  info: [{ label: "Call 9-1-1 first", anchor: "emergency" }, { label: "Park emergency line", anchor: "emergency-line" }, { label: "Office hours", anchor: "office-hours" }, { label: "Park rules", anchor: "park-rules" }],
  // Oct 29 (per Mely — "dentro de profile haz otro sub menú con lo que hay, ex. marketplace").
  // Oct 30: Marketplace opens the Marketplace page (the anchor only held a link to it).
  more: [{ label: "My information", anchor: "resident-info" }, { label: "Emergency contact", anchor: "emergency-contact" }, { label: "Marketplace", anchor: "marketplace", href: "/residents/marketplace" }, { label: "Documents", href: "/residents/documents" }],
};
export const sectionFor = (h: string): SectionId | null =>
  SECTIONS.some((x) => x.id === h) ? (h as SectionId) : ANCHOR_SECTION[h] || null;
const isSection = (x: unknown): x is SectionId => typeof x === "string" && SECTIONS.some((s) => s.id === x);
/** Stable key of a sub item — the page for page links, else the anchor. */
export const subKey = (it: SubItem) => it.href || it.anchor || it.label;

// What the conditional items depend on (the park's settings + the resident's data).
export type NavFlags = { maintenance: boolean; propane: boolean; recHall: boolean };
export function filterSubItems(id: SectionId, f: NavFlags): SubItem[] {
  return (SUBMENU[id] || []).filter((it) => it.anchor !== "maintenance" || f.maintenance).filter((it) => it.anchor !== "propane" || f.propane).filter((it) => it.anchor !== "rec-hall" || f.recHall);
}
// Oct 28 (per Mely): Requests holds maintenance (if the park turned it on) and propane orders.
// Nothing to show there → hide the Requests nav item too.
export const requestsVisible = (f: NavFlags) => f.maintenance || f.propane || f.recHall;

/** Href of a portal sub-page, remembering which section it was opened from (for "Back"). */
export const subPageHref = (href: string, from: SectionId) => `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
/** Where a sub-page's "Back" goes: the section it was opened from (?from=), else its parent. */
export function portalBackHref(fallback: SectionId): string {
  let from: string | null = null;
  try { from = new URLSearchParams(window.location.search).get("from"); } catch {}
  return `/residents/dashboard#${isSection(from) && from !== "home" ? from : fallback}`;
}

// The dashboard saves the menu's flags + red numbers for this browser tab so the sub-pages show the
// same menu (no extra fetching there). Missing → conditional items hidden, no numbers.
type NavContext = { rid: string | null; flags: NavFlags; badge: Partial<Record<SectionId, number>>; moreBadge: number };
const CTX_KEY = "rp_nav_ctx";
function currentResidentId(): string | null {
  try { return window.localStorage.getItem("resident_id"); } catch { return null; }
}
export function SaveNavContext({ flags, badge, moreBadge }: Omit<NavContext, "rid">) {
  const json = JSON.stringify({ rid: currentResidentId(), flags, badge, moreBadge });
  useEffect(() => {
    try { window.sessionStorage.setItem(CTX_KEY, json); } catch {}
  }, [json]);
  return null;
}
function readNavContext(): NavContext | null {
  try {
    const c = JSON.parse(window.sessionStorage.getItem(CTX_KEY) || "null") as NavContext | null;
    if (!c || !c.flags || c.rid !== currentResidentId()) return null;
    return c;
  } catch {
    return null;
  }
}

export function NavIcon({ d }: { d: string }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
export const NavBadge = ({ n }: { n?: number }) => (n ? <span className="rp-nav-badge">{n}</span> : null);

type NavProps = {
  sections: SectionId[];
  section: SectionId; // highlighted section
  subFolded: SectionId | null; // section whose sub-menu is folded
  activeSub: string | null; // subKey of the highlighted sub item
  subItems: (id: SectionId) => SubItem[];
  badge: Partial<Record<SectionId, number>>;
  onSection: (id: SectionId) => void;
  onSub: (it: SubItem) => void;
};

export function ResidentSideNav({ sections, section, subFolded, activeSub, subItems, badge, onSection, onSub }: NavProps) {
  const { t } = usePortalLang();
  return (
    <nav className="rp-nav" aria-label={t("Resident Portal")}>
      {SECTIONS.filter((x) => sections.includes(x.id)).map((x) => {
        const subs = subItems(x.id);
        const open = section === x.id && subFolded !== x.id && subs.length > 0;
        return (
          <Fragment key={x.id}>
            <button type="button" className={section === x.id ? "on" : ""} onClick={() => onSection(x.id)} aria-current={section === x.id && !activeSub ? "page" : undefined} aria-expanded={subs.length > 0 ? open : undefined}>
              <NavIcon d={x.id === "more" ? PROFILE_ICON : x.icon} /><span>{t(x.label)}</span><NavBadge n={badge[x.id]} />
            </button>
            {open && (
              <div className="rp-subnav">
                {subs.map((it) => {
                  const on = activeSub === subKey(it);
                  return <button key={it.label} type="button" className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => onSub(it)}>{t(it.label)}</button>;
                })}
              </div>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Phone: the section's items as chips at the top of the page. */
export function ResidentSubChips({ items, activeSub, onSub }: { items: SubItem[]; activeSub: string | null; onSub: (it: SubItem) => void }) {
  const { t } = usePortalLang();
  const row = useRef<HTMLDivElement>(null);
  // Keep the highlighted chip in view (sideways only — the page itself doesn't move).
  useEffect(() => {
    const box = row.current;
    const on = box?.querySelector<HTMLElement>("button.on");
    if (!box || !on) return;
    box.scrollTo({ left: Math.max(0, on.offsetLeft - box.offsetLeft - (box.clientWidth - on.offsetWidth) / 2), behavior: "smooth" });
  }, [activeSub, items.length]);
  if (!items.length) return null;
  return (
    <div ref={row} className="rp-subchips" role="navigation" aria-label={t("In this section")}>
      {items.map((it) => {
        const on = activeSub === subKey(it);
        return <button key={it.label} type="button" className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => onSub(it)}>{t(it.label)}</button>;
      })}
    </div>
  );
}

export function ResidentTabBar({ section, badge, moreBadge, onSection }: { section: SectionId; badge: Partial<Record<SectionId, number>>; moreBadge: number; onSection: (id: SectionId) => void }) {
  const { t } = usePortalLang();
  return (
    <nav className="rp-tabbar" aria-label={t("Resident Portal")}>
      {MOBILE_TABS.map((id) => {
        const x = SECTIONS.find((s) => s.id === id)!;
        const on = section === id || (id === "more" && UNDER_MORE.includes(section));
        return (
          <button key={id} type="button" className={on ? "on" : ""} onClick={() => onSection(id)} aria-current={on ? "page" : undefined}>
            <NavIcon d={x.icon} /><span>{t(x.short)}</span><NavBadge n={id === "more" ? moreBadge : badge[id]} />
          </button>
        );
      })}
    </nav>
  );
}

// Portal sub-pages → the dashboard section they belong to.
export const SUBPAGE_SECTION: Record<string, SectionId> = {
  "/residents/invoices": "pay",
  "/residents/payment-history": "pay",
  "/residents/payment-review": "pay",
  "/electric-history": "pay",
  "/residents/documents": "lot",
  "/residents/maintenance": "requests",
  "/residents/marketplace": "more",
  "/residents/background-checks": "household",
};

/** Wraps a portal sub-page with the same side menu / tab bar as the dashboard. */
export function ResidentSubPageFrame({ children }: { children: ReactNode }) {
  const pathname = (usePathname() || "").replace(/\/+$/, "");
  const parent = SUBPAGE_SECTION[pathname];
  if (!parent) return <>{children}</>;
  return <SubPageFrame pathname={pathname} parent={parent}>{children}</SubPageFrame>;
}

// The address' ?from= and the dashboard's saved menu context, read on the client only (the server
// render and the first client render show the defaults, so there's no hydration mismatch).
const noSubscribe = () => () => {};
function readClientState(): string {
  try { return `${new URLSearchParams(window.location.search).get("from") || ""}\n${window.sessionStorage.getItem(CTX_KEY) || ""}`; } catch { return "\n"; }
}

function SubPageFrame({ pathname, parent, children }: { pathname: string; parent: SectionId; children: ReactNode }) {
  const router = useRouter();
  const client = useSyncExternalStore(noSubscribe, readClientState, () => "\n");
  const [from, ctxJson] = client.split("\n");
  const section: SectionId = isSection(from) && from !== "home" ? from : parent;
  const ctx = useMemo(() => (ctxJson ? readNavContext() : null), [ctxJson]);
  const [subFolded, setSubFolded] = useState<SectionId | null>(null);

  const flags: NavFlags = ctx?.flags || { maintenance: pathname === "/residents/maintenance", propane: false, recHall: false };
  const badge = ctx?.badge || {};
  const sections = SECTIONS.map((x) => x.id).filter((id) => id !== "requests" || requestsVisible(flags) || section === "requests");
  const subItems = (id: SectionId) => filterSubItems(id, flags);
  const current = subItems(section).find((it) => it.href === pathname);
  const activeSub = current ? subKey(current) : null;

  function onSection(id: SectionId) {
    if (id === section && subItems(id).length > 0) { setSubFolded((f) => (f === id ? null : id)); return; }
    router.push(`/residents/dashboard#${id}`);
  }
  function onSub(it: SubItem) {
    if (it.href) {
      if (it.href === pathname) { window.scrollTo({ top: 0 }); return; }
      router.push(subPageHref(it.href, section));
      return;
    }
    if (it.anchor) router.push(`/residents/dashboard#${it.anchor}`);
  }

  return (
    <section className="rp-wrap rp-subpage">
      <div className="rp-portal">
        <ResidentSideNav sections={sections} section={section} subFolded={subFolded} activeSub={activeSub} subItems={subItems} badge={badge} onSection={onSection} onSub={onSub} />
        <div className="rp-main rp-sub-main">
          <ResidentSubChips items={subItems(section)} activeSub={activeSub} onSub={onSub} />
          {children}
        </div>
      </div>
      <ResidentTabBar section={section} badge={badge} moreBadge={ctx?.moreBadge || 0} onSection={(id) => router.push(`/residents/dashboard#${id}`)} />
    </section>
  );
}
