/**
 * Ticket S2-12 — `/ops/twins`. Lives under `app/ops/` so it inherits the sidebar/topbar shell
 * from `app/ops/layout.tsx` automatically, same as `/ops` and `/ops/labels`.
 *
 * Server component wrapper only: the actual MQTT connection and the Leaflet/R3F canvases are
 * all client-side (see components/twins/TwinsDashboard.tsx and its "use client" + dynamic
 * ssr:false imports) — there is nothing to fetch server-side here, unlike `/ops`'s
 * `page.tsx`, which does a first-paint HTTP fetch before handing off to a client poll. MQTT
 * has no equivalent "ask once over HTTP" fallback, so this page starts from nothing and lets
 * the client component's retained-message subscribe fill it in, honestly, on connect.
 */

import { TwinsDashboard } from "../../../components/twins/TwinsDashboard";

export default function TwinsPage() {
  return (
    <div className="twins-page">
      {/* Visually replaced by <TwinsDashboard>'s own hero heading — kept for a11y/SEO heading
          hierarchy without showing a duplicate title on screen, same pattern as /ops. */}
      <h1 className="sr-only">Swarm twins</h1>

      <TwinsDashboard />
    </div>
  );
}
