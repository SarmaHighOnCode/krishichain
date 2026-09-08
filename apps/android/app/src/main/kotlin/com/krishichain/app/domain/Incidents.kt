package com.krishichain.app.domain

/**
 * Cold-chain breach detection — Kotlin port of `apps/web/lib/incidents.ts`, shared between the
 * badge decision (`Badge.kt`), the chart, and the timeline so they can never disagree about
 * whether a breach happened.
 *
 * `record.t` is deci-degrees Celsius (PROTOCOL.md §1.1: 254 = 25.4C); `tempMaxC` is a
 * whole-degree threshold (10 = 10.0C) — hence the `/ 10.0` (floating-point, matching the JS
 * `record.t / 10 > tempMaxC` behavior) before comparing.
 */

interface LotRecordLike {
    val seq: Int
    val t: Int
}

data class IncidentSummary(
    val breached: Boolean,
    /** seq of the first breaching record, or null when there was no breach. */
    val breachStart: Int?,
    /** seq of the last breaching record, or null when there was no breach. */
    val breachEnd: Int?,
)

/** `.env.example`'s `TEMP_MAX_C` default. */
const val DEFAULT_TEMP_MAX_C: Int = 10

/** Is this single reading above the cold-chain threshold? */
fun isBreaching(record: LotRecordLike, tempMaxC: Int = DEFAULT_TEMP_MAX_C): Boolean =
    record.t / 10.0 > tempMaxC

/** Scan a run of records for a cold-chain breach and report its seq range. */
fun deriveIncidents(
    records: List<LotRecordLike>,
    tempMaxC: Int = DEFAULT_TEMP_MAX_C,
): IncidentSummary {
    var breachStart: Int? = null
    var breachEnd: Int? = null

    for (record in records) {
        if (isBreaching(record, tempMaxC)) {
            if (breachStart == null) breachStart = record.seq
            breachEnd = record.seq
        }
    }

    return IncidentSummary(breached = breachStart != null, breachStart = breachStart, breachEnd = breachEnd)
}
