"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Oct 21 (per Mely): the marina website's top menu, organized in drop-downs
// (Slips, Services). Services only lists what this marina really has (fuel
// prices, ship store items, dry stack slips), so no menu link ever leads nowhere.
export type MarinaServices = { fuel: boolean; store: boolean; dry: boolean; rentals?: boolean; concierge?: boolean; careers?: boolean; restaurant?: boolean; events?: boolean };
type Item = { href: string; label: string; note?: string };

export default function MarinaNav({ services, demo }: { services: MarinaServices; demo: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);

  const slips: Item[] = [
    { href: "/#slips", label: "Slip map", note: "See open slips and reserve" },
    { href: "/#rates", label: "Rates", note: "Monthly, seasonal and annual" },
    { href: "/#waitlist", label: "Waitlist", note: "For slips that are full" },
  ];
  const svc: Item[] = [
    ...(services.fuel ? [{ href: "/#fuel", label: "Fuel dock", note: "Today's prices per gallon" }] : []),
    ...(services.store ? [{ href: "/marina/store", label: "Ship store", note: "Shop by category" }] : []),
    ...(services.dry ? [{ href: "/marina/account#launch", label: "Dry stack launch", note: "Ask for your boat in the water" }] : []),
    ...(services.rentals ? [{ href: "/marina/rentals", label: "Rentals & experiences", note: "Golf carts, boats, tours and more" }] : []),
    ...(services.concierge ? [{ href: "/marina/concierge", label: "Concierge", note: "Ice, provisions, catering, crew to your slip" }] : []),
  ];
  const restaurantLink = services.restaurant ? { href: "/marina/restaurant", label: "Restaurant" } : null;
  const groups: { key: string; label: string; items: Item[] }[] = [
    { key: "slips", label: "Slips", items: slips },
    ...(svc.length ? [{ key: "services", label: "Services", items: svc }] : []),
  ];
  const go = () => setOpen(null);

  return (
    <nav className="mr-nav" aria-label="Main" ref={ref}>
      {groups.map((g) => (
        <div className="mr-dd mr-desk" key={g.key}>
          <button type="button" className="mr-dd-btn" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
            {g.label} <span aria-hidden className="mr-caret">▾</span>
          </button>
          {open === g.key && (
            <div className="mr-dd-menu" role="menu">
              {g.items.map((i) => (
                <a key={i.href + i.label} href={i.href} role="menuitem" onClick={go}>
                  <b>{i.label}</b>{i.note && <small>{i.note}</small>}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      {services.events && <a className="mr-link mr-desk" href="/marina/events">Events</a>}
      <a className="mr-link mr-desk" href="/marina/marketplace">Marketplace</a>
      {restaurantLink && <a className="mr-link mr-desk" href={restaurantLink.href}>Restaurant</a>}
      {services.careers && <a className="mr-link mr-desk" href="/marina/careers">Careers</a>}
      <a className="mr-link mr-desk" href="/#contact">Contact</a>
      {demo && <Link className="mr-link mr-desk" href="/marina/tour">Office tour</Link>}

      {/* Phones: one "Menu" button with every group. */}
      <div className="mr-dd mr-mob">
        {/* Oct 22 (per Mely): just the three lines (no "Menu" word); Boater login goes inside. */}
        <button type="button" className="mr-dd-btn mr-burger" aria-label="Menu" aria-expanded={open === "all"} onClick={() => setOpen(open === "all" ? null : "all")}>
          {open === "all"
            ? <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            : <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>}
        </button>
        {open === "all" && (
          <div className="mr-dd-menu mr-dd-right" role="menu">
            <Link className="mr-btn mr-menu-login" href="/marina/account" onClick={go}>Boater login</Link>
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mr-dd-head">{g.label}</div>
                {g.items.map((i) => (
                  <a key={i.href + i.label} href={i.href} role="menuitem" onClick={go}><b>{i.label}</b></a>
                ))}
              </div>
            ))}
            <div className="mr-dd-head">More</div>
            {services.events && <a href="/marina/events" onClick={go}><b>Events</b></a>}
            <a href="/marina/marketplace" onClick={go}><b>Marketplace</b></a>
            {restaurantLink && <a href="/marina/restaurant" onClick={go}><b>Restaurant</b></a>}
            {services.careers && <a href="/marina/careers" onClick={go}><b>Careers</b></a>}
            <a href="/#contact" onClick={go}><b>Contact</b></a>
            {demo && <Link href="/marina/tour" onClick={go}><b>Office tour</b></Link>}
          </div>
        )}
      </div>

      <Link className="mr-btn mr-desk" href="/marina/account">Boater login</Link>
    </nav>
  );
}
