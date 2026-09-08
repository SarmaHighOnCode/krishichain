/**
 * Same-origin proxy for the gateway's `GET /ops/summary`, used by the ops dashboard's 3 s
 * client-side poll (S2-07).
 *
 * The browser can't fetch the gateway directly: it's a different origin
 * (localhost:3000 -> localhost:8080) and the gateway sends no `Access-Control-Allow-Origin`
 * header (apps/gateway is another owner's scope — CLAUDE.md says stay out of it, not add CORS
 * there). Routing the poll through this Next.js route handler keeps the browser's request
 * same-origin; the actual cross-origin call happens server-side, where CORS doesn't apply.
 */

import { fetchOpsSummary } from "../../../../lib/ops";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

export async function GET() {
  const summary = await fetchOpsSummary(GATEWAY);
  if (!summary) {
    return Response.json({ error: "gateway unreachable" }, { status: 502 });
  }
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
