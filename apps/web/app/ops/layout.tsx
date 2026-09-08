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
import { DashboardTopbar } from "./DashboardTopbar";
import "./dashboard-theme.css";
import { networkForChainId } from "../../lib/deployments";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_VERIFY_CHAIN_ID ?? "80002");

export default function OpsLayout({ children }: { children: ReactNode }) {
  const network = networkForChainId(CHAIN_ID);

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="dash-sidebar__brand">
          <span className="dash-sidebar__mark" aria-hidden="true">
            K
          </span>
          <div className="dash-sidebar__brand-text">
            <span className="dash-sidebar__wordmark">KrishiChain</span>
            <span className="dash-sidebar__eyebrow">Ops console</span>
          </div>
        </div>

        <DashboardNav />
      </aside>

      <div className="dash-main">
        <DashboardTopbar network={network} gatewayUrl={GATEWAY_URL} />

        <div className="dash-content">{children}</div>
      </div>
    </div>
  );
}
