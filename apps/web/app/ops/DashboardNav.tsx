"use client";

/**
 * S2-12 — sidebar nav for the ops dashboard shell. Split out as its own client component
 * because `app/ops/layout.tsx` stays a server component (it does no data fetching of its own,
 * no reason to opt the whole shell into the client), but active-route highlighting needs
 * `usePathname()`.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** Minimal 18x18 stroke icons, hand-drawn inline — no icon library dependency. */
const icons = {
  grid: (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="2" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="10" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="10" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M8.4 2.5H4a1.5 1.5 0 0 0-1.5 1.5v4.4c0 .4.16.78.44 1.06l6.1 6.1a1.5 1.5 0 0 0 2.12 0l4.4-4.4a1.5 1.5 0 0 0 0-2.12l-6.1-6.1a1.5 1.5 0 0 0-1.06-.44Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="6.2" cy="6.2" r="1.1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  external: (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M7.5 3H4A1.5 1.5 0 0 0 2.5 4.5v9A1.5 1.5 0 0 0 4 15h9a1.5 1.5 0 0 0 1.5-1.5V10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M10.5 2.5H15.5V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3 8.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  /** S2-12 — a little cube, for the map + 3D-lite crate twins. */
  twins: (
    <svg viewBox="0 0 18 18" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M9 2.2 15 5.6v6.8L9 15.8 3 12.4V5.6L9 2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3 5.6 9 9m0 0 6-3.4M9 9v6.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
};

const NAV_ITEMS: NavItem[] = [
  { href: "/ops", label: "Overview", icon: icons.grid },
  { href: "/ops/twins", label: "Twins", icon: icons.twins },
  { href: "/ops/labels", label: "Labels", icon: icons.tag },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/ops") return pathname === "/ops";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Section label for the current route — used by DashboardTopbar's breadcrumb too. */
export function sectionLabel(pathname: string): string {
  const match = NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
  return match?.label ?? "Overview";
}

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <>
      <div className="dash-nav-group">
        <p className="dash-nav-group__label">Menu</p>
        <nav className="dash-nav" aria-label="Ops dashboard">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`dash-nav__link${isActivePath(pathname, item.href) ? " dash-nav__link--active" : ""}`}
            >
              <span className="dash-nav__icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="dash-sidebar__section">
        <Link href="/" className="dash-nav__link dash-nav__link--muted">
          <span className="dash-nav__icon" aria-hidden="true">
            {icons.external}
          </span>
          Consumer view
        </Link>
      </div>
    </>
  );
}
