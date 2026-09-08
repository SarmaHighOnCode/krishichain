"use client";

/**
 * S2-12 — sidebar nav for the ops dashboard shell. Split out as its own client component
 * because `app/ops/layout.tsx` stays a server component (it does no data fetching of its own,
 * no reason to opt the whole shell into the client), but active-route highlighting needs
 * `usePathname()`.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/labels", label: "Labels" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/ops") return pathname === "/ops";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <Fragment>
      <nav className="dash-nav" aria-label="Ops dashboard">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`dash-nav__link${isActive(pathname, item.href) ? " dash-nav__link--active" : ""}`}
          >
            <span className="dash-nav__dot" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="dash-sidebar__section">
        <Link href="/" className="dash-nav__link">
          <span className="dash-nav__dot" aria-hidden="true" />
          Consumer view
        </Link>
      </div>
    </Fragment>
  );
}
