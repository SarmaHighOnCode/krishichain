"use client";

/**
 * S2-12 — top bar for the ops dashboard shell. Needs `usePathname()` for the breadcrumb, so it's
 * split out from the server-component `layout.tsx` the same way `DashboardNav` is.
 *
 * This is the one piece of chrome shared by both /ops and /ops/labels — /ops/labels has no hero
 * of its own, so the network/gateway context lives here rather than duplicated per-page.
 */

import { usePathname } from "next/navigation";

import { sectionLabel } from "./DashboardNav";

export function DashboardTopbar({ network, gatewayUrl }: { network: string; gatewayUrl: string }) {
  const pathname = usePathname();
  const gatewayHost = gatewayUrl.replace(/^https?:\/\//, "");

  return (
    <header className="dash-topbar">
      <span className="dash-topbar__crumb">
        Ops <span className="dash-topbar__crumb-sep">/</span>{" "}
        <span className="dash-topbar__crumb-current">{sectionLabel(pathname)}</span>
      </span>

      <div className="dash-topbar__right">
        <span className="dash-topbar__meta">
          <span className="dash-topbar__meta-dot" aria-hidden="true" />
          {gatewayHost}
        </span>
        <span className="dash-topbar__pill">{network}</span>
      </div>
    </header>
  );
}
