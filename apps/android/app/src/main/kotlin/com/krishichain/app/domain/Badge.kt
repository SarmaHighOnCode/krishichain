package com.krishichain.app.domain

/**
 * The verdict badge, as an explicit decision function — Kotlin port of `apps/web/components/Badge.tsx`
 * (`decideVerificationStatus`). Using the real verdict vocabulary rather than "any verdict != ACCEPT"
 * is what lets `CHAIN_GAP` (records missing) look different from `DUPLICATE` (a harmless replay).
 */

interface BadgeRecord : LotRecordLike {
    val verdict: String
    val anchored: Boolean
}

enum class VerificationStatus {
    UNVERIFIABLE,
    FLAGGED,
    PENDING_ANCHOR,
    VERIFIED,
}

/** CHAIN_GAP and CHAIN_FORK are trust breaks — records are missing or the device's history
 *  diverged. DUPLICATE alone is not: it's an idempotent replay and must not escalate. */
private val CHAIN_BREAKS = setOf(ChainVerdict.CHAIN_GAP, ChainVerdict.CHAIN_FORK)

fun decideVerificationStatus(
    records: List<BadgeRecord>,
    tempMaxC: Int = DEFAULT_TEMP_MAX_C,
): VerificationStatus {
    if (records.any { it.verdict in CHAIN_BREAKS }) return VerificationStatus.UNVERIFIABLE

    val (breached) = deriveIncidents(records, tempMaxC)
    if (breached) return VerificationStatus.FLAGGED

    if (!records.all { it.anchored }) return VerificationStatus.PENDING_ANCHOR

    return VerificationStatus.VERIFIED
}

data class BadgeCopy(val label: String)

val BADGE_COPY: Map<VerificationStatus, BadgeCopy> = mapOf(
    VerificationStatus.UNVERIFIABLE to BadgeCopy("Unverifiable — chain gap or fork"),
    VerificationStatus.FLAGGED to BadgeCopy("Flagged — cold chain breach"),
    VerificationStatus.PENDING_ANCHOR to BadgeCopy("Pending anchor"),
    VerificationStatus.VERIFIED to BadgeCopy("Verified"),
)
