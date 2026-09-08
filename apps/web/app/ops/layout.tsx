/**
 * S2-12 — shared desktop dashboard shell for /ops and /ops/labels.
 *
 * Sidebar + top bar chrome, per stripe/DESIGN.md (see dashboard-theme.css for the namespaced
 * token mapping). Server component: no data fetching here, and no client state beyond the
 * active-route highlight, which is split out into <DashboardNav> so this file doesn't need to
 * opt into "use client" itself.
 */

import type { ReactNode } from "react";

import { DashboardNav } from "./DashboardNav";
import "./dashboard-theme.css";

export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="dash-sidebar__brand">
          <span className="dash-sidebar__wordmark">KrishiChain</span>
          <span className="dash-sidebar__eyebrow">Ops</span>
        </div>

        <DashboardNav />
      </aside>

      <div className="dash-main">
        <header className="dash-topbar">
          <span className="dash-topbar__crumb">Ops</span>
        </header>

        <div className="dash-content">{children}</div>
      </div>
    </div>
  );
}
