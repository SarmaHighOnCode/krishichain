/**
 * Ops dashboard — tickets S2-06 (node health / buffer depth / last-seen / incidents) and
 * S2-07 (3 s live polling). For the FPO manager and transporter personas, not the consumer
 * (that's /verify/[lotId]).
 *
 * Server component does the first fetch so the page has real numbers on first paint even with
 * JS disabled; <OpsDashboard> (client) takes it from there with the 3 s poll.
 *
 * S2-12: the outer page chrome (sidebar/topbar/content width) now lives in ./layout.tsx — this
 * component only owns the page-specific heading and the dashboard content itself.
 */

import { OpsDashboard } from "../../components/OpsDashboard";
import { fetchOpsSummary } from "../../lib/ops";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

export default async function OpsPage() {
  const initialSummary = await fetchOpsSummary(GATEWAY);

  return (
    <div className="ops-page">
      <h1>Ops dashboard</h1>
      <p className="muted">Field node health, buffer depth and incidents — live from the gateway.</p>

      <OpsDashboard initialSummary={initialSummary} />
    </div>
  );
}
