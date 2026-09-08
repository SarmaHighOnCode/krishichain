/**
 * Cold-chain breach detection (ticket S2-05), shared between `Badge.tsx`, `ColdChainChart.tsx`
 * and `JourneyTimeline.tsx` so the badge, the chart, and the per-reading flags can never
 * disagree about whether a breach happened.
 *
 * `record.t` is deci-degrees Celsius (PROTOCOL.md §1.1: 254 = 25.4C), and `TEMP_MAX_C` in
 * `.env.example` is a whole-degree threshold (10 = 10.0C) — hence the `/10` before comparing.
 */

import { Flags } from "@krishichain/core";

export interface LotRecordLike {
  seq: number;
  t: number;
}

export interface IncidentSummary {
  breached: boolean;
  /** seq of the first breaching record, or null when there was no breach. */
  breachStart: number | null;
  /** seq of the last breaching record, or null when there was no breach. */
  breachEnd: number | null;
}

/** `.env.example`'s `TEMP_MAX_C` default. The web app has no `NEXT_PUBLIC_TEMP_MAX_C` (no
 *  need for a second copy of a gateway-owned config value) so this is the shared fallback. */
export const DEFAULT_TEMP_MAX_C = 10;

/** Is this single reading above the cold-chain threshold? */
export function isBreaching(record: LotRecordLike, tempMaxC: number = DEFAULT_TEMP_MAX_C): boolean {
  return record.t / 10 > tempMaxC;
}

/** Scan a run of records for a cold-chain breach and report its seq range. */
export function deriveIncidents(
  records: LotRecordLike[],
  { tempMaxC = DEFAULT_TEMP_MAX_C }: { tempMaxC?: number } = {},
): IncidentSummary {
  let breachStart: number | null = null;
  let breachEnd: number | null = null;

  for (const record of records) {
    if (isBreaching(record, tempMaxC)) {
      if (breachStart === null) breachStart = record.seq;
      breachEnd = record.seq;
    }
  }

  return { breached: breachStart !== null, breachStart, breachEnd };
}

/**
 * A record whose `flags` carries the `SENSOR_FAULT` bit (PROTOCOL.md §1.1). `t` and `h` are
 * then the fault sentinels (-32768 / 65535, not real readings) — every consumer of these
 * fields (ColdChainChart, JourneyTimeline) must check this before doing any arithmetic on
 * `t`/`h`, or it renders sensor failure as if it were data (e.g. -3276.8C).
 *
 * The Android app's virtual-node feature sends exactly this for every reading (no phone has a
 * calibrated temp/humidity sensor), so this is live data from a real feature, not a
 * hypothetical edge case.
 */
export function isSensorFault(record: { flags: number }): boolean {
  return (record.flags & Flags.SENSOR_FAULT) !== 0;
}
