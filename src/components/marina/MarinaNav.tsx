"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Oct 21 (per Mely): the marina website's top menu, organized in drop-downs
// (Slips, Services). Services only lists what this marina really has (fuel
// prices, ship store items, dry stack slips), so no menu link ever leads nowhere.
export type MarinaServices = { fuel: boolean; store: boolean; dry: boolean };
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
    ...(services.store ? [{ href: "/#store", label: "Ship store", note: "Ice, bait, drinks and supplies" }] : []),
    ...(services.dry ? [{ href: "/marina/account#launch", label: "Dry stack launch", note: "Ask for your boat in the water" }] : []),
  ];
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
      <a className="mr-link mr-desk" href="/#contact">Contact</a>
      {demo && <Link className="mr-link mr-desk" href="/marina/tour">Office tour</Link>}

      {/* Phones: one "Menu" button with every group. */}
      <div className="mr-dd mr-mob">
        <button type="button" className="mr-dd-btn" aria-expanded={open === "all"} onClick={() => setOpen(open === "all" ? null : "all")}>
          Menu <span aria-hidden className="mr-caret">☰</span>
        </button>
        {open === "all" && (
          <div className="mr-dd-menu mr-dd-right" role="menu">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mr-dd-head">{g.label}</div>
                {g.items.map((i) => (
                  <a key={i.href + i.label} href={i.href} role="menuitem" onClick={go}><b>{i.label}</b></a>
                ))}
              </div>
            ))}
            <div className="mr-dd-head">More</div>
            <a href="/#contact" onClick={go}><b>Contact</b></a>
            {demo && <Link href="/marina/tour" onClick={go}><b>Office tour</b></Link>}
          </div>
        )}
      </div>

      <Link className="mr-btn" href="/marina/account">Boater login</Link>
    </nav>
  );
}
